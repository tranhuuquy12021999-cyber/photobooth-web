// File: boloc/trang_hong.js

if (typeof ALL_FILTERS === 'undefined') var ALL_FILTERS = [];

ALL_FILTERS.push({
    id: 'tranghong',
    name: 'Trắng Hồng',
    icon: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',

    // Đường dẫn ảnh bảng màu LUT bạn xuất từ Lightroom (512x512px)
    lutSrc: 'boloc/trang_hong_lut.png',

    // Tắt hoàn toàn các hiệu ứng cũ (mặt nạ da, tô môi)
    baseFilter: 'none',
    faceFilter: null,
    hasLipstick: false,
    lipstickColor: null
});
