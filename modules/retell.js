/* modules/retell.js - Fixed Endpoint */
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
        // console.log(`[Retell] Fetching KB Info: ${kbId}`);
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
        console.log(`[Retell] Deleting old source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
    } catch (error) {
        console.error(`[Retell] Delete Source Error: ${error.message}`);
    }
}

// 3. Add Text Source (Corrected: PLURAL Endpoint)
async function addTextSource(kbId, title, text) {
    try {
        // Correct Payload Structure for the plural endpoint
        const payload = {
            knowledge_base_texts: [
                {
                    title: title,
                    text: text
                }
            ]
        };

        console.log(`[Retell] Adding new source to ${kbId}...`);

        // [FIX] Use the correct plural endpoint with ID in the URL
        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            payload,
            { headers }
        );

        console.log(`[Retell] Success! Source added.`);
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

    // 1. Check current KB
    const kbData = await getKnowledgeBase(kbId);

    // 2. Clean up old "Daily Menu"
    if (kbData.knowledge_base_sources) {
        for (const source of kbData.knowledge_base_sources) {
            if (source.filename === "Daily Menu" || source.title === "Daily Menu") {
                await deleteSource(kbId, source.knowledge_base_source_id);
            }
        }
    }

    // 3. Add new menu
    await addTextSource(kbId, "Daily Menu", menuText);

    return true;
}

module.exports = { updateMenuInKB };
