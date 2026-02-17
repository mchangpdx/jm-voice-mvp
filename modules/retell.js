/* modules/retell.js */
const axios = require('axios');
require('dotenv').config();

const RETELL_API_URL = 'https://api.retellai.com';
const API_KEY = process.env.RETELL_API_KEY;

// 헤더 설정
const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 1. 기존 지식보관소 정보 가져오기
async function getKnowledgeBase(kbId) {
    try {
        const response = await axios.get(`${RETELL_API_URL}/get-knowledge-base/${kbId}`, { headers });
        return response.data;
    } catch (error) {
        console.error('[Retell] Get KB Error:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// 2. 특정 소스(Source) 삭제하기
async function deleteSource(kbId, sourceId) {
    try {
        await axios.delete(`${RETELL_API_URL}/delete-knowledge-base-source/${kbId}/source/${sourceId}`, { headers });
        console.log(`[Retell] Deleted old source: ${sourceId}`);
    } catch (error) {
        console.error('[Retell] Delete Source Error:', error.message);
    }
}

// 3. 텍스트 소스 추가하기
async function addTextSource(kbId, title, text) {
    try {
        const payload = {
            knowledge_base_texts: [
                {
                    title: title,
                    text: text
                }
            ]
        };
        const response = await axios.post(`${RETELL_API_URL}/add-knowledge-base-sources/${kbId}`, payload, { headers });
        console.log(`[Retell] Added new menu source. Status: ${response.data.status}`);
        return response.data;
    } catch (error) {
        console.error('[Retell] Add Source Error:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// [핵심] 메뉴 업데이트 전체 로직 (삭제 후 재생성)
async function updateMenuInKB(kbId, menuText) {
    console.log('[Retell] Starting Menu Update...');
    
    // 1. 현재 KB 상태 조회
    const kbData = await getKnowledgeBase(kbId);
    
    // 2. 기존 "Daily Menu" 소스가 있다면 삭제 (중복 방지)
    if (kbData.knowledge_base_sources) {
        const oldMenu = kbData.knowledge_base_sources.find(s => s.filename === "Daily Menu" || s.title === "Daily Menu");
        if (oldMenu) {
            await deleteSource(kbId, oldMenu.source_id);
        }
    }

    // 3. 새로운 메뉴 텍스트 업로드
    await addTextSource(kbId, "Daily Menu", menuText);
    console.log('[Retell] Menu Update Complete!');
    return true;
}

module.exports = { updateMenuInKB };