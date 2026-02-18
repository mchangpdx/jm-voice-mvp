/* modules/retell.js - Robust Cleanup & Multipart Upload */
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

// 1. Get KB Info
async function getKnowledgeBase(kbId) {
    try {
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`[Retell] Get KB Error: ${error.message}`);
        throw error;
    }
}

// 2. Delete Source
async function deleteSource(kbId, sourceId) {
    try {
        if (!sourceId) {
            console.error("[Retell] Cannot delete source: ID is missing!");
            return;
        }
        console.log(`[Retell] Deleting old source: ${sourceId}`);
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/${sourceId}`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.warn(`[Retell] Delete Warning: ${error.message}`);
    }
}

// 3. Add Text Source (Multipart - PROVEN WORKING)
async function addTextSource(kbId, menuText) {
    try {
        const now = new Date();
        const timeString = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${now.getHours()}h${now.getMinutes()}m`;
        const uniqueTitle = `Daily Menu ${timeString}`;

        console.log(`[Retell] Uploading: "${uniqueTitle}"`);

        const form = new FormData();
        const textsPayload = JSON.stringify([
            {
                title: uniqueTitle,
                text: menuText
            }
        ]);

        form.append('knowledge_base_texts', textsPayload);

        const response = await axios.post(
            `${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${API_KEY}`
                }
            }
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
    console.log('[Retell] Starting Menu Sync...');

    // A. Fetch Current Sources
    const kbData = await getKnowledgeBase(kbId);

    // B. Smart Cleanup (Robust ID Check)
    if (kbData.knowledge_base_sources) {
        const oldMenus = kbData.knowledge_base_sources.filter(source =>
            source.title && source.title.includes("Daily Menu")
        );

        if (oldMenus.length > 0) {
            console.log(`[Retell] Found ${oldMenus.length} old menu(s). Cleaning up...`);

            // [DEBUG] Log the first item to see structure if needed
            // console.log("Sample Source Object:", JSON.stringify(oldMenus[0]));

            for (const source of oldMenus) {
                // [FIX] Try all possible ID fields
                const idToDelete = source.knowledge_base_source_id || source.source_id || source.id;

                if (idToDelete) {
                    await deleteSource(kbId, idToDelete);
                } else {
                    console.error("[Retell] Failed to identify ID for source:", JSON.stringify(source));
                }
            }
            // Wait for deletions
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    // C. Add New Menu
    await addTextSource(kbId, menuText);

    return true;
}

module.exports = { updateMenuInKB };
