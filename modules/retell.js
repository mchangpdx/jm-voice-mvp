/* modules/retell.js - Fixed URLs & Logic */
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

// 1. Get KB Info (Removed query param to fix 400 Error)
async function getKnowledgeBase(kbId) {
    try {
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, {
            headers: getCommonHeaders()
        });
        return response.data;
    } catch (error) {
        console.error(`[Retell] Get KB Error: ${error.message}`);
        throw error;
    }
}

// 2. Delete Source (CORRECTED URL with '/source/')
async function deleteSource(kbId, sourceId) {
    if (!sourceId) return;
    try {
        console.log(`[Retell] Deleting: ${sourceId}`);

        // [CRITICAL FIX] Added '/source/' segment to the URL
        const url = `${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/source/${sourceId}`;

        await axios.delete(url, { headers: getCommonHeaders() });
        console.log(`[Retell] Deleted successfully: ${sourceId}`);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(`[Retell] Already gone: ${sourceId}`);
        } else {
            console.warn(`[Retell] Delete Warning: ${error.message}`);
        }
    }
}

// 3. Add Text Source (Multipart)
async function addTextSource(kbId, menuText) {
    try {
        // [FIX] Use Portland, Oregon Timezone
        const now = new Date();
        const timeZone = 'America/Los_Angeles';

        const fmt = (options) => now.toLocaleString('en-US', { timeZone, ...options });

        const year = fmt({ year: 'numeric' });
        const month = fmt({ month: 'numeric' });
        const day = fmt({ day: 'numeric' });
        const hour = fmt({ hour: 'numeric', hour12: false });
        const minute = fmt({ minute: 'numeric' });

        const timeString = `${year}-${month}-${day} ${hour}h${minute}m`;
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

// Main Logic
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Sync...');

    // 1. Fetch Current Sources
    const kbData = await getKnowledgeBase(kbId);

    // 2. Cleanup Old Menus
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell] Found ${oldMenus.length} old items to delete.`);

            // Delete all old menus
            for (const source of oldMenus) {
                const idToDelete = source.knowledge_base_source_id || source.source_id;
                await deleteSource(kbId, idToDelete);
            }

            // Wait a moment for deletions to propagate
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // 3. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
