// File: boloc/trang_hong.js

if (typeof ALL_FILTERS === 'undefined') var ALL_FILTERS = [];

ALL_FILTERS.push({
    id: 'tranghong',
    name: 'Trắng Hồng',
    icon: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop', // Đổi link icon nếu bạn có ảnh icon riêng
    cssFilter: 'brightness(1.20) contrast(1.02) saturate(1.2) sepia(0.05) hue-rotate(-2deg) blur(1.2px)', // Đã đẩy sáng da
    hasLipstick: true,                               // Cho phép tô môi
    lipstickColor: 'rgba(255, 50, 90, 0.3)'          // Đỏ hồng
});
