// File: style3/khung_gty.js

if (typeof ALL_FRAMES === 'undefined') {
    var ALL_FRAMES = [];
}

ALL_FRAMES.push({ 
    id: 'f_gty', 
    type: 3, 
    name: 'Gấu Tình Yêu', 
    src: 'style3/GTY.png', // Đảm bảo bạn lưu ảnh khung trong suốt dưới dạng GTY.png trong thư mục style3
    layout: {
        canvasW: 1500, canvasH: 3400,
        photos: [
            // Tọa độ y của ảnh thứ n: y_trước + h_trước + gap
            { x: 350, y: 912, w: 800, h: 620 },
            { x: 350, y: 1582, w: 800, h: 620 }, // 912 + 620 + 50 = 1582
            { x: 350, y: 2252, w: 800, h: 620 }  // 1582 + 620 + 50 = 2252
        ]
    }
});
