// File: boloc/trang_hong.js

if (typeof ALL_FILTERS === 'undefined') var ALL_FILTERS = [];

ALL_FILTERS.push({
    id: 'tranghong',
    name: 'Trắng Hồng',
    icon: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop', 
    
    // Bộ lọc cho cảnh vật (chỉ sáng lên rất nhẹ 2%)
    baseFilter: 'brightness(1.02)', 
    
    // Bộ lọc chỉ áp dụng trên da mặt (Đẩy trắng, tăng hồng và làm mịn da mạnh)
    faceFilter: 'brightness(1.25) contrast(1.02) saturate(1.15) sepia(0.05) hue-rotate(-2deg) blur(1.5px)', 
    
    hasLipstick: true,
    // Đã giảm độ đậm của son môi xuống mức 0.12 để tiệp vào màu môi thật, không bị giả
    lipstickColor: 'rgba(255, 50, 90, 0.12)' 
});
