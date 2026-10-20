import { getContext, extension_settings, writeExtensionField } from "../../../../../extensions.js";
import { saveSettingsDebounced, saveChat, saveChatConditional, updateMessageBlock, getRequestHeaders, getThumbnailUrl, user_avatar, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from "../../../../../../script.js";
import { SlashCommandParser } from "../../../../../slash-commands/SlashCommandParser.js";
import { backupToMessage, rehydrateFromHistory, rehydrateFromHistoryAsync, applyLLMPatch, extractNormalizedPatch } from "./JSONTracker.js";
import { parseResponse } from "./ResponseParser.js";
import { buildUpdatePromptWrapper } from "./ActivePrompt.js";
import { DEFAULT_PROMPT_HEADER_SEP, DEFAULT_PROMPT_FOOTER_SEP } from "./PromptSchema.js";
import { setDeltaLog } from "../tracker/DeltaLogRenderer.js";

import { createChatLockStore, getChatKey } from './ChatLockStore.js';
import { createPresetBridge } from './PresetBridge.js';
import { getAppliedDelta } from './AppliedDelta.js';

const chatLocks = createChatLockStore(getContext);

import { resolveSillyTavernAvatarUrl } from "./AvatarResolver.js";
import { getAvailableModels, executeQuietPromptWithModelOverride } from "./ModelManager.js";

window.SillyTavern = {
    getContext: () => {
        try {
            const ctx = getContext();
            return {
                ...ctx,
                user_avatar: user_avatar
            };
        } catch (e) {
            return { user_avatar: user_avatar };
        }
    }
};

export function safeUpdateMessageBlock(index, messageObject) {
    if (typeof updateMessageBlock !== 'function') return;
    try {
        updateMessageBlock(index, messageObject);
    } catch (e) {
        setTimeout(() => {
            try {
                updateMessageBlock(index, messageObject);
            } catch (err) {
                console.warn("[RPG Tracker] Delayed updateMessageBlock failed:", err);
            }
        }, 100);
    }
}

export function establishBridgeConnection(extensionName) {
    const connectionInterval = setInterval(() => {
        if (window.RPGBridge && typeof window.RPGBridge.syncSettings === 'function') {
            clearInterval(connectionInterval);

            window.RPGBridge.latestSettings = extension_settings[extensionName] || null;
            window.RPGBridge.isQuietUpdating = false;
            window.RPGBridge.getCurrentChatKey = () => getChatKey(getContext());
            window.RPGBridge.recordChatLocks = tracker => chatLocks.remember(tracker);
            window.RPGBridge.applyChatLocks = tracker => chatLocks.restore(tracker);
            window.RPGBridge.createSaveTarget = () => {
                const context = getContext();
                const index = (context.chat?.length || 0) - 1;
                const message = context.chat?.[index];
                const matched = message?.swipes?.findIndex(text => text === message.mes) ?? -1;
                const swipeId = matched >= 0 ? matched : (message?.swipe_id || 0);
                return { chatKey: getChatKey(context), message, index, swipeId };
            };
            Object.assign(window.RPGBridge, createPresetBridge({
                extensionName,
                getRequestHeaders,
                syncPresets: presets => {
                    extension_settings[extensionName] ??= {};
                    extension_settings[extensionName].presets = presets;
                    window.RPGBridge.latestSettings = extension_settings[extensionName];
                    window.RPGBridge.syncSettings({ presets });
                },
            }));
            window.RPGBridge.extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

            window.RPGBridge.writeExtensionFieldNatively = async (characterId, key, value) => {
                if (typeof writeExtensionField === 'function') {
                    try {
                        await writeExtensionField(characterId, key, value);
                        return true;
                    } catch (err) {
                        console.error("[RPG Tracker] writeExtensionField failed:", err);
                        return false;
                    }
                }
                console.warn("[RPG Tracker] writeExtensionField is not available on SillyTavern's extensions.js");
                return false;
            };

            window.RPGBridge.getSTSettingsCharacterSyncs = (chatId) => {
                if (!chatId) return null;
                const targetSrc = window.RPGBridge.latestSettings || extension_settings[extensionName];
                return targetSrc?.characterSyncs?.[chatId] || null;
            };

            const nativeSyncSettings = window.RPGBridge.syncSettings;
            window.RPGBridge.syncSettings = (stSettings) => {
                if (stSettings) {
                    window.RPGBridge.latestSettings = {
                        ...(window.RPGBridge.latestSettings || {}),
                        ...stSettings
                    };
                    nativeSyncSettings(stSettings);
                }
            };

            window.RPGBridge.getThumbnailUrl = (type, filename) => {
                try {
                    if (typeof getThumbnailUrl === 'function') {
                        let url = getThumbnailUrl(type, filename);
                        if (!url) {
                            const fallbackType = type === 'persona' ? 'avatar' : 'persona';
                            url = getThumbnailUrl(fallbackType, filename);
                        }
                        return url;
                    }
                } catch (e) {
                    console.warn("[RPG Tracker] Failed to retrieve native thumbnail URL:", e);
                }
                return null;
            };

            window.RPGBridge.getAvailableModels = getAvailableModels;

            window.RPGBridge.saveSettings = (updatedSettings) => {
                extension_settings[extensionName] = extension_settings[extensionName] || {};
                Object.assign(extension_settings[extensionName], updatedSettings);
                window.RPGBridge.latestSettings = extension_settings[extensionName];
                saveSettingsDebounced();
            };

            window.RPGBridge.saveChatData = (updatedTracker, maxBackupCount, target = null) => {
                const context = getContext();
                const currentChat = context.chat;
                const lastIndex = target ? target.index : (currentChat ? currentChat.length - 1 : -1);
                if (target && (target.chatKey !== getChatKey(context) || currentChat?.[lastIndex] !== target.message)) return;

                const safeSaveChat = () => {
                    if (typeof saveChatConditional === 'function') saveChatConditional();
                    else if (!context.groupId && typeof saveChat === 'function') saveChat();
                };

                const settings = window.RPGBridge?.latestSettings || {};
                let effectiveMaxKeep = 20;

                if (settings.keepAllBackups === true) {
                    effectiveMaxKeep = -1;
                } else if (settings.maxBackupCount !== undefined) {
                    effectiveMaxKeep = settings.maxBackupCount;
                } else if (maxBackupCount !== undefined) {
                    effectiveMaxKeep = maxBackupCount;
                }

                if (currentChat && lastIndex >= 0) {
                    backupToMessage(currentChat, lastIndex, updatedTracker, safeUpdateMessageBlock, safeSaveChat, effectiveMaxKeep, target?.swipeId);
                }
            };

            window.RPGBridge.rehydrateFromHistory = () => rehydrateFromHistory(getContext().chat);
            window.RPGBridge.rehydrateFromHistoryAsync = async () => await rehydrateFromHistoryAsync(getContext().chat);

            window.RPGBridge.connectChat = (currentTrackerData) => {
                const context = getContext();
                if (context && context.chatId) {
                    if (typeof window.RPGBridge.saveChatData === 'function') {
                        window.RPGBridge.saveChatData(currentTrackerData);
                    }
                    if (typeof saveChatConditional === 'function') saveChatConditional();
                    else if (!context.groupId && typeof saveChat === 'function') saveChat();

                    if (typeof window.RPGBridge.setChatConnectionStatus === 'function') {
                        window.RPGBridge.setChatConnectionStatus(true);
                    }
                }
            };

            window.RPGBridge.disconnectChat = () => {
                const context = getContext();
                if (context && context.chatId) {
                    const currentChat = context.chat;
                    if (currentChat && currentChat.length > 0) {
                        for (let i = 0; i < currentChat.length; i++) {
                            const msg = currentChat[i];
                            if (msg && msg.mes && (msg.mes.includes('<!--RPG_TRACKER:') || msg.mes.includes('<!--RPG_DATA:') || msg.mes.includes('<!--RPG_DELTA:'))) {
                                msg.mes = msg.mes.replace(/<!--RPG_TRACKER:([\s\S]*?)-->/g, '').trim();
                                msg.mes = msg.mes.replace(/<!--RPG_DATA:([\s\S]*?)-->/g, '').trim();
                                msg.mes = msg.mes.replace(/<!--RPG_DELTA:([\s\S]*?)-->/g, '').trim();
                                safeUpdateMessageBlock(i, msg);
                            }
                        }
                        if (typeof saveChatConditional === "function") saveChatConditional();
                        else if (!context.groupId && typeof saveChat === "function") saveChat();
                    }

                    if (extension_settings.extension_prompts) {
                        delete extension_settings.extension_prompts[`${extensionName}_def`];
                        delete extension_settings.extension_prompts[`${extensionName}_status`];
                    }

                    $('#rpg-snapshot-styles').remove();
                    $('#rpg-delta-log-styles').remove();
                    $('.rpg-delta-log-container').remove();
                    $('.rpg-snapshot-container').remove();

                    if (typeof window.RPGBridge.setChatConnectionStatus === 'function') {
                        window.RPGBridge.setChatConnectionStatus(false);
                    }
                }
            };

            window.RPGBridge.updateMessageBlock = (index, messageObject) => {
                safeUpdateMessageBlock(index, messageObject);
            };

            window.RPGBridge.saveChat = () => {
                if (typeof saveChatConditional === 'function') {
                    saveChatConditional();
                } else if (!getContext().groupId && typeof saveChat === 'function') {
                    saveChat();
                }
            };

            window.RPGBridge.triggerCharacterGeneration = async (promptText, isPlayer = false) => {
                const requestChatKey = getChatKey(getContext());
                const requestRevision = window.RPGBridge.historyRevision || 0;
                const trackerData = window.RPGBridge?.currentTrackerData;
                if (!trackerData) return;

                const settings = window.RPGBridge?.latestSettings || extension_settings[extensionName] || {};
                const targetModel = settings.useCustomModel ? settings.customModel : null;

                const header = trackerData.systemPromptHeader_separated !== undefined ? trackerData.systemPromptHeader_separated : DEFAULT_PROMPT_HEADER_SEP;
                const footer = trackerData.systemPromptFooter_separated !== undefined ? trackerData.systemPromptFooter_separated : DEFAULT_PROMPT_FOOTER_SEP;

                const defPrompt = buildUpdatePromptWrapper(trackerData, header, footer, isPlayer);

                try {
                    if (typeof setExtensionPrompt === 'function' && typeof extension_prompt_types !== 'undefined') {
                        setExtensionPrompt(`${extensionName}_def`, defPrompt, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM || 0);
                    }

                    const instructionText = `[USER INSTRUCTION]\n${promptText}\n\nOutput the generated character's status JSON block only.`;

                    const rawOutput = await executeQuietPromptWithModelOverride(extensionName, instructionText, targetModel, false, false);
                    if (getChatKey(getContext()) !== requestChatKey || (window.RPGBridge.historyRevision || 0) !== requestRevision) return;
                    const { patch } = parseResponse(rawOutput);

                    if (patch && Object.keys(patch).length > 0) {
                        const normPatch = extractNormalizedPatch(patch);
                        const latestData = chatLocks.restore(window.RPGBridge.currentTrackerData);
                        const updatedData = chatLocks.restore(applyLLMPatch(latestData, normPatch, isPlayer));
                        const appliedDelta = getAppliedDelta(latestData, updatedData, normPatch);
                        if (typeof window.RPGBridge.syncChatData === 'function') window.RPGBridge.syncChatData(updatedData);

                        try {
                            const sysText = `[RPG Tracker] System has added a new character. <!--RPG_DELTA:${JSON.stringify(appliedDelta)}-->`;
                            await SlashCommandParser.commands['sys'].callback({}, sysText);

                            if (getChatKey(getContext()) !== requestChatKey) return;
                            const newContext = getContext();
                            if (newContext && newContext.chat) {
                                let lastSysMsgIdx = -1;
                                for (let i = newContext.chat.length - 1; i >= 0; i--) {
                                    if (newContext.chat[i] && typeof newContext.chat[i].mes === 'string' && newContext.chat[i].mes.includes('[RPG Tracker] System has added a new character')) {
                                        lastSysMsgIdx = i;
                                        break;
                                    }
                                }

                                if (lastSysMsgIdx !== -1) {
                                    const lastSysMsg = newContext.chat[lastSysMsgIdx];
                                    setDeltaLog(lastSysMsg, appliedDelta);
                                    safeUpdateMessageBlock(lastSysMsgIdx, lastSysMsg);
                                }
                            }
                            if (typeof saveChatConditional === "function") saveChatConditional();
                            else if (typeof saveChat === "function") saveChat();

                            if (getChatKey(getContext()) === requestChatKey && typeof window.RPGBridge.saveChatData === 'function') window.RPGBridge.saveChatData(window.RPGBridge.currentTrackerData);
                        } catch (err) {
                            if (getChatKey(getContext()) === requestChatKey && typeof window.RPGBridge.saveChatData === 'function') window.RPGBridge.saveChatData(window.RPGBridge.currentTrackerData);
                        }
                    } else {
                        try {
                            await SlashCommandParser.commands['sys'].callback({}, "[RPG Tracker] Generation failed (No valid JSON found).");
                        } catch (err) { }
                    }
                } catch (e) {
                    console.error("[RPG Tracker] Character generation error:", e);
                }
            };

            window.RPGBridge.triggerManualUpdate = async () => {
                const requestChatKey = getChatKey(getContext());
                const requestRevision = window.RPGBridge.historyRevision || 0;
                const trackerData = window.RPGBridge?.currentTrackerData;
                if (!trackerData || !Array.isArray(trackerData.characters)) return;

                const settings = window.RPGBridge?.latestSettings || extension_settings[extensionName] || {};
                const targetModel = settings.useCustomModel ? settings.customModel : null;

                const header = trackerData.systemPromptHeader_separated !== undefined ? trackerData.systemPromptHeader_separated : DEFAULT_PROMPT_HEADER_SEP;
                const footer = trackerData.systemPromptFooter_separated !== undefined ? trackerData.systemPromptFooter_separated : DEFAULT_PROMPT_FOOTER_SEP;

                const systemPromptText = buildUpdatePromptWrapper(trackerData, header, footer);

                try {
                    if (typeof setExtensionPrompt === 'function' && typeof extension_prompt_types !== 'undefined') {
                        setExtensionPrompt(`${extensionName}_def`, systemPromptText, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM || 0);
                    }

                    const instructionText = "Analyze the recent chat log above and current status, then output the updated status JSON block only.";

                    const rawOutput = await executeQuietPromptWithModelOverride(extensionName, instructionText, targetModel, false, false);
                    if (getChatKey(getContext()) !== requestChatKey || (window.RPGBridge.historyRevision || 0) !== requestRevision) return;
                    const { patch } = parseResponse(rawOutput);

                    if (patch && Object.keys(patch).length > 0) {
                        const normPatch = extractNormalizedPatch(patch);
                        const latestData = chatLocks.restore(window.RPGBridge.currentTrackerData);
                        const updatedData = chatLocks.restore(applyLLMPatch(latestData, normPatch));
                        const appliedDelta = getAppliedDelta(latestData, updatedData, normPatch);
                        if (typeof window.RPGBridge.syncChatData === 'function') window.RPGBridge.syncChatData(updatedData);

                        try {
                            const sysText = `[RPG Tracker] Status has been manually updated. <!--RPG_DELTA:${JSON.stringify(appliedDelta)}-->`;
                            await SlashCommandParser.commands['sys'].callback({}, sysText);

                            if (getChatKey(getContext()) !== requestChatKey) return;
                            const freshContext = getContext();
                            const activeChat = freshContext?.chat;
                            if (activeChat) {
                                let lastSysMsgIdx = -1;
                                for (let i = activeChat.length - 1; i >= 0; i--) {
                                    if (activeChat[i] && typeof activeChat[i].mes === 'string' && activeChat[i].mes.includes('[RPG Tracker] Status has been manually updated')) {
                                        lastSysMsgIdx = i;
                                        break;
                                    }
                                }

                                if (lastSysMsgIdx !== -1) {
                                    const lastSysMsg = activeChat[lastSysMsgIdx];
                                    setDeltaLog(lastSysMsg, appliedDelta);
                                    safeUpdateMessageBlock(lastSysMsgIdx, lastSysMsg);
                                }
                            }
                            if (typeof saveChatConditional === "function") saveChatConditional();
                            else if (typeof saveChat === "function") saveChat();

                            if (getChatKey(getContext()) === requestChatKey && typeof window.RPGBridge.saveChatData === 'function') window.RPGBridge.saveChatData(window.RPGBridge.currentTrackerData);
                        } catch (err) {
                            if (getChatKey(getContext()) === requestChatKey && typeof window.RPGBridge.saveChatData === 'function') window.RPGBridge.saveChatData(window.RPGBridge.currentTrackerData);
                        }
                    } else {
                        try {
                            await SlashCommandParser.commands['sys'].callback({}, "[RPG Tracker] No valid updates found.");
                        } catch (err) { }
                    }
                } catch (e) {
                    console.error("[RPG Tracker] Manual update error:", e);
                    throw e;
                }
            };

            window.RPGBridge.getUserPersonaName = () => {
                try { return getContext()?.name1 || 'Player'; } catch (e) { return 'Player'; }
            };

            window.RPGBridge.getRequestHeaders = () => {
                if (typeof getRequestHeaders === 'function') return getRequestHeaders();
                return {};
            };

            window.RPGBridge.syncSettings(extension_settings[extensionName]);

            let historyRequest = 0;
            const syncFromHistoryOrMeta = async () => {
                const request = ++historyRequest;
                const context = getContext();
                const chatKey = getChatKey(context);
                window.RPGBridge.prepareChatScope?.(chatKey);
                // Settings/persona refreshes may arrive before the editor's save
                // debounce. Commit its original snapshot before reading history.
                window.RPGBridge.flushSave?.();
                const revision = window.RPGBridge.historyRevision || 0;
                const trackerRevision = window.RPGBridge.trackerRevision || 0;
                if (!context || !context.chatId) {
                    if (typeof window.RPGBridge.resetToDefault === 'function') window.RPGBridge.resetToDefault();
                    if (typeof window.RPGBridge.setChatConnectionStatus === 'function') window.RPGBridge.setChatConnectionStatus(false);
                    return;
                }

                let trackerData = null;
                if (Array.isArray(context.chat)) {
                    trackerData = await window.RPGBridge.rehydrateFromHistoryAsync();
                }

                if (request !== historyRequest || getChatKey(getContext()) !== chatKey
                    || (window.RPGBridge.historyRevision || 0) !== revision
                    || (window.RPGBridge.trackerRevision || 0) !== trackerRevision) return;
                if (trackerData && typeof window.RPGBridge.syncChatData === 'function') {
                    if (Array.isArray(trackerData.characters)) {
                        trackerData.characters.forEach((c, index) => {
                            const chatSyncs = window.RPGBridge.latestSettings?.characterSyncs?.[context.chatId] || extension_settings[extensionName]?.characterSyncs?.[context.chatId] || {};
                            const savedSync = chatSyncs[c.id] ?? chatSyncs[index];
                            if (savedSync) {
                                c.syncedCardAvatar = savedSync.syncedCardAvatar;
                                c.syncedCardType = savedSync.syncedCardType;
                                c.name = savedSync.name;
                                c.avatarUrl = savedSync.avatarUrl;
                            } else {
                                c.syncedCardAvatar = null;
                                c.syncedCardType = null;
                            }

                            if (c.syncedCardType === 'Persona') {
                                const liveName = context.name1 || window.name1;
                                if (liveName && c.name !== liveName) {
                                    c.name = liveName;
                                }
                                const userAvatarFile = user_avatar || context.user_avatar || window.user_avatar;
                                const globalCrop = extension_settings[extensionName]?.croppedAvatars?.[c.id];
                                const targetAvatarUrl = globalCrop || resolveSillyTavernAvatarUrl(userAvatarFile, 'Persona');
                                c.syncedCardAvatar = userAvatarFile || null;
                                c.avatarUrl = targetAvatarUrl;
                            } else if (c.syncedCardType === 'Card' && c.syncedCardAvatar) {
                                const allChars = Array.isArray(context.characters) ? context.characters : (Array.isArray(window.characters) ? window.characters : []);
                                const matched = allChars.find(stChar => stChar.avatar === c.syncedCardAvatar);
                                if (matched) {
                                    if (c.name !== matched.name) {
                                        c.name = matched.name;
                                    }
                                    const globalCrop = extension_settings[extensionName]?.croppedAvatars?.[c.id];
                                    const targetAvatarUrl = globalCrop || resolveSillyTavernAvatarUrl(matched.avatar, 'Card');
                                    c.avatarUrl = targetAvatarUrl;
                                }
                            } else if (!c.syncedCardType) {
                                const globalCrop = extension_settings[extensionName]?.croppedAvatars?.[c.id];
                                c.avatarUrl = globalCrop || null;
                            }
                        });
                    }

                    window.RPGBridge.syncChatData(trackerData);
                    if (typeof window.RPGBridge.setChatConnectionStatus === 'function') {
                        window.RPGBridge.setChatConnectionStatus(true);
                    }
                } else if (typeof window.RPGBridge.resetToDefault === 'function') {
                    window.RPGBridge.resetToDefault();
                    if (typeof window.RPGBridge.setChatConnectionStatus === 'function') {
                        window.RPGBridge.setChatConnectionStatus(true);
                    }
                }
            };

            window.RPGBridge.syncFromHistoryOrMeta = syncFromHistoryOrMeta;
            syncFromHistoryOrMeta();
        }
    }, 100);

    setTimeout(() => clearInterval(connectionInterval), 10000);
}