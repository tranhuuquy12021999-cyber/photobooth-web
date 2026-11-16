// File: 64tinh/tinh_thanh.js

if (typeof ALL_FRAMES === 'undefined') var ALL_FRAMES = [];

const layoutChungTinhThanh = {
    canvasW: 1200, canvasH: 3600,
    photos: [
        { x: 83, y: 239, w: 1034, h: 745 },
        { x: 83, y: 1081, w: 1034, h: 745 },
        { x: 83, y: 1923, w: 1034, h: 745 }
    ]
};

// 1. CÁC KHUNG NỀN DÙNG CHUNG
const baseFrames = [
    { idPrefix: 'pb', namePrefix: 'Phong Bì', src: '64tinh/khungphongbi.png' },
    { idPrefix: 'gb', namePrefix: 'Giấy Báo', src: '64tinh/giaybao.png' }
];

// 2. CÁC TEM TỈNH THÀNH (Đường dẫn chuẩn trỏ vào thư mục 64tinh)
const PROVINCES_DATA = [
    { id: 'hanam', name: 'Hà Nam', overlaySrc: '64tinh/hanam.png' },
    { id: 'ninhbinh', name: 'Ninh Bình', overlaySrc: '64tinh/ninhbinh.png' },
    { id: 'hanoi', name: 'Hà Nội', overlaySrc: '64tinh/hanoi.png' }
];

// 3. NHÂN BẢN TỰ ĐỘNG
baseFrames.forEach(base => {
    PROVINCES_DATA.forEach(prov => {
        ALL_FRAMES.push({
            id: `f_${base.idPrefix}_${prov.id}`, 
            type: 3, 
            provId: prov.id,
            name: `${base.namePrefix}`, // Trên danh sách chỉ hiện "Phong Bì" hoặc "Giấy Báo"
            category: '64 Tỉnh Thành',
            src: base.src,
            overlaySrc: prov.overlaySrc,
            overlayPos: { x: 88, y: 2773, w: 1027, h: 741 }, 
            layout: layoutChungTinhThanh
        });
    });
});
