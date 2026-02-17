/* modules/retell.js - Official API Compliant Version */
const axios = require('axios');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 1. Get KB Info
// Endpoint: GET /get-knowledge-base/{knowledge_base_id} (This one DOES use URL param)
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
// Endpoint: DELETE /delete-knowledge-base-source/{knowledge_base_id}/{source_id} (Correct)
async function deleteSource(kbId, sourceId) {
    try {
        console.log(`[Retell] Cleaning up source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, { headers });
    } catch (error) {
        // Ignore 404 (already deleted)
        if (error.response && error.response.status === 404) return;
        console.warn(`[Retell] Delete Warning: ${error.message}`);
    }
}

// 3. Add Text Source (THE FIX)
// Endpoint: POST /add-knowledge-base-sources (NO ID in URL)
// Body: { knowledge_base_id, knowledge_base_sources }
async function addTextSource(kbId, menuText) {
    try {
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        // [OFFICIAL DOCS FORMAT]
        // 1. URL: /add-knowledge-base-sources
        // 2. Body includes 'knowledge_base_id'
        const payload = {
            knowledge_base_id: kbId, // <--- MOVED ID HERE
            knowledge_base_sources: [
                {
                    type: "text",
                    title: uniqueTitle,
                    text: menuText
                }
            ]
        };

        console.log(`[Retell] Uploading "${uniqueTitle}" to API...`);

        // [FIX] URL does NOT have ${kbId} at the end
        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources`,
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

// Main Logic (Smart Update)
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Official Menu Update...');

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
            // Wait for deletions to settle
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
