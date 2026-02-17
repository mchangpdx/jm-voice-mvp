/* modules/retell.js - Robust Version */
const axios = require('axios');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 1. Get KB Info (to verify connection)
async function getKnowledgeBase(kbId) {
    try {
        console.log(`[Retell] Fetching KB Info: ${kbId}`);
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, { headers });
        return response.data;
    } catch (error) {
        console.error(`[Retell] Get KB Error: ${error.message}`);
        // If this fails, the ID is wrong or Key is wrong
        throw error;
    }
}

// 2. Delete Source (Cleanup)
async function deleteSource(kbId, sourceId) {
    try {
        console.log(`[Retell] Deleting old source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
        // Wait a bit for the deletion to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        console.warn(`[Retell] Delete Source Warning: ${error.message} (Continuing...)`);
    }
}

// 3. Add Text Source (With Unique Title)
async function addTextSource(kbId, menuText) {
    try {
        // [Fix] Use a unique title to prevent 500 errors from backend collisions
        const today = new Date().toISOString().split('T')[0];
        const uniqueTitle = `Daily Menu (${today} - ${Date.now()})`;

        const payload = {
            knowledge_base_texts: [
                {
                    title: uniqueTitle,
                    text: menuText
                }
            ]
        };

        console.log(`[Retell] Sending Payload to ${kbId}...`);

        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            payload,
            { headers }
        );

        console.log(`[Retell] Success! Source added. ID: ${response.data.knowledge_base_sources?.[0]?.knowledge_base_source_id}`);
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

// Main Update Function
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Update Process...');

    // 1. Get current sources
    const kbData = await getKnowledgeBase(kbId);

    // 2. Delete OLD "Daily Menu" sources (Clean up)
    if (kbData.knowledge_base_sources) {
        for (const source of kbData.knowledge_base_sources) {
            // Delete if it starts with "Daily Menu"
            if (source.title.startsWith("Daily Menu")) {
                await deleteSource(kbId, source.knowledge_base_source_id);
            }
        }
    }

    // 3. Add NEW menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
