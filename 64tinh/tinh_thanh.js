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

// 1. CHỈ KHAI BÁO KHUNG TỔNG (Sẽ hiện trên danh sách bên phải)
ALL_FRAMES.push({
    id: 'f_pb', type: 3, name: 'Phong Bì', category: '64 Tỉnh Thành',
    src: '64tinh/khungphongbi.png', layout: layoutChungTinhThanh
});
ALL_FRAMES.push({
    id: 'f_gb', type: 3, name: 'Giấy Báo', category: '64 Tỉnh Thành',
    src: '64tinh/giaybao.png', layout: layoutChungTinhThanh
});

// 2. KHAI BÁO CÁC TEM TỈNH THÀNH (Dùng để ghép tự động vào ảnh bên trái)
const PROVINCES_DATA = [
    { id: 'hanam', name: 'Hà Nam', overlaySrc: '64tinh/hanam.png' },
    { id: 'ninhbinh', name: 'Ninh Bình', overlaySrc: '64tinh/ninhbinh.png' },
    { id: 'hanoi', name: 'Hà Nội', overlaySrc: '64tinh/hanoi.png' }
    // Thêm các tỉnh khác vào đây
];
