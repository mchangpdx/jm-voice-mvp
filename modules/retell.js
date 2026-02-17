/* modules/retell.js - Final Working Version */
const axios = require('axios');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 1. Get KB Info
async function getKnowledgeBase(kbId) {
    try {
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, { headers });
        return response.data;
    } catch (error) {
        console.error(`[Retell] Get KB Error: ${error.message}`);
        throw error;
    }
}

// 2. Delete Source
async function deleteSource(kbId, sourceId) {
    try {
        console.log(`[Retell] Cleaning up old menu source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
    } catch (error) {
        // Ignore 404s (already deleted)
        if (error.response && error.response.status === 404) return;
        console.warn(`[Retell] Delete Warning: ${error.message}`);
    }
}

// 3. Add Text Source (Corrected Key & Clean Title)
async function addTextSource(kbId, menuText) {
    try {
        // [FIX] Simple Alphanumeric Title to prevent 500 errors
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        // [FIX] Back to 'knowledge_base_texts' which is the ONLY correct key for text
        const payload = {
            knowledge_base_texts: [
                {
                    title: uniqueTitle,
                    text: menuText
                }
            ]
        };

        console.log(`[Retell] Uploading: "${uniqueTitle}"...`);

        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            payload,
            { headers }
        );

        console.log(`[Retell] Success! New Source Added.`);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error(`[Retell Error] Status: ${error.response.status}`);
            console.error(`[Retell Error] Data:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(`[Retell Error] ${error.message}`);
        }
        throw error;
    }
}

// Main Logic
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Safe Menu Update...');

    // A. Fetch Current Sources
    const kbData = await getKnowledgeBase(kbId);

    // B. Smart Delete: Only delete items with "Daily Menu" in title
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell] Found ${oldMenus.length} old menu(s). Deleting...`);
            for (const source of oldMenus) {
                await deleteSource(kbId, source.knowledge_base_source_id);
            }
            // [FIX] Safety Delay: Wait 2 seconds for Retell to process deletions
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
