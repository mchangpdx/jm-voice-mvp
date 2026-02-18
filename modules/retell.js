/* modules/retell.js - Force Delete & Anti-Cache */
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

function getCommonHeaders() {
    return {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    };
}

// 1. Get KB Info (Anti-Caching)
async function getKnowledgeBase(kbId) {
    try {
        // [FIX] Add timestamp to prevent caching
        const url = `${RETELL_API_URL}/get-knowledge-base/${kbId}?_t=${Date.now()}`;
        const response = await axios.get(url, { headers: getCommonHeaders() });
        return response.data;
    } catch (error) {
        console.error(`[Retell] Get KB Error: ${error.message}`);
        throw error;
    }
}

// 2. Delete Source
async function deleteSource(sourceId) {
    if (!sourceId) return;
    try {
        console.log(`[Retell] Attempting delete: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${sourceId}`, {
            headers: getCommonHeaders()
        });
        console.log(`[Retell] Delete request sent for: ${sourceId}`);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(`[Retell] Already deleted (404): ${sourceId}`);
        } else {
            console.warn(`[Retell] Delete Warning: ${error.message}`);
        }
    }
}

// 3. Add Text Source (Multipart)
async function addTextSource(kbId, menuText) {
    try {
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        console.log(`[Retell] Uploading: "${uniqueTitle}"`);

        const form = new FormData();
        const textsPayload = JSON.stringify([{ title: uniqueTitle, text: menuText }]);
        form.append('knowledge_base_texts', textsPayload);

        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            form,
            {
                headers: { ...form.getHeaders(), 'Authorization': `Bearer ${API_KEY}` }
            }
        );
        console.log(`[Retell] Success! New Source Added.`);
        return response.data;
    } catch (error) {
        console.error(`[Retell Error] Upload Failed: ${error.message}`);
        throw error;
    }
}

// Main Logic (Recursive Cleanup)
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Fresh Sync...');

    // Phase 1: Cleanup Loop (Max 3 retries)
    for (let i = 0; i < 3; i++) {
        const kbData = await getKnowledgeBase(kbId);

        if (!kbData.knowledge_base_sources) break;

        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length === 0) {
            console.log("[Retell] Clean slate confirmed. No old menus.");
            break;
        }

        console.log(`[Retell] Cleanup Round ${i+1}: Found ${oldMenus.length} old items.`);

        // Delete all found
        await Promise.all(oldMenus.map(source => {
            // console.log("Source Item:", JSON.stringify(source));
            return deleteSource(source.knowledge_base_source_id);
        }));

        // Wait for server to process
        await new Promise(r => setTimeout(r, 2000));
    }

    // Phase 2: Add New
    await addTextSource(kbId, menuText);
    return true;
}

module.exports = { updateMenuInKB };
