/* modules/retell.js - Smart Update & Collision Fix */
const axios = require('axios');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 1. Get KB Info (Source List)
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

// 2. Delete Specific Source
async function deleteSource(kbId, sourceId) {
    try {
        console.log(`[Retell] Deleting old menu source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
        // Pause briefly to ensure deletion is processed on server side
        await new Promise(r => setTimeout(r, 500));
    } catch (error) {
        console.warn(`[Retell] Delete Warning: ${error.message}`);
    }
}

// 3. Add New Source (With Unique Timestamp)
async function addTextSource(kbId, menuText) {
    try {
        // [Critical Fix] Append Timestamp to title to avoid 500 Duplicate Error
        const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
        const uniqueTitle = `Daily Menu [${timestamp}]`;

        const payload = {
            knowledge_base_texts: [
                {
                    title: uniqueTitle,
                    text: menuText
                }
            ]
        };

        console.log(`[Retell] Uploading: "${uniqueTitle}"`);

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

// [Main Logic] Smart Update
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Smart Menu Update...');

    // Step A: Get current sources
    const kbData = await getKnowledgeBase(kbId);

    // Step B: Find ONLY "Daily Menu" sources to delete
    // We leave "Parking Info", "Wifi", etc. completely alone.
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell] Found ${oldMenus.length} old menu file(s). Cleaning up...`);
            for (const source of oldMenus) {
                await deleteSource(kbId, source.knowledge_base_source_id);
            }
        } else {
            console.log(`[Retell] No old menu files found. Clean start.`);
        }
    }

    // Step C: Add the new menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
