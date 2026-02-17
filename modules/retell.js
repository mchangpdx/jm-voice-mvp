/* modules/retell.js - Final Payload Fix */
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
        console.log(`[Retell] Deleting old source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
        await new Promise(r => setTimeout(r, 500)); // Safety delay
    } catch (error) {
        console.warn(`[Retell] Delete Warning: ${error.message}`);
    }
}

// 3. Add Text Source (Payload Key Fixed)
async function addTextSource(kbId, menuText) {
    try {
        const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
        const uniqueTitle = `Daily Menu [${timestamp}]`;

        // [CRITICAL FIX] Changed 'knowledge_base_texts' to 'knowledge_base_sources'
        // Added 'type: "text"'
        const payload = {
            knowledge_base_sources: [
                {
                    type: "text",
                    title: uniqueTitle,
                    text: menuText
                }
            ]
        };

        console.log(`[Retell] Uploading to ${kbId} with Correct Payload...`);

        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            payload,
            { headers }
        );

        console.log(`[Retell] Success! New Source ID: ${response.data.knowledge_base_sources?.[0]?.knowledge_base_source_id}`);
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

// Main Smart Update Logic
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Smart Menu Update...');

    // A. Get current sources
    const kbData = await getKnowledgeBase(kbId);

    // B. Cleanup Old "Daily Menu" only
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        for (const source of oldMenus) {
            await deleteSource(kbId, source.knowledge_base_source_id);
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
