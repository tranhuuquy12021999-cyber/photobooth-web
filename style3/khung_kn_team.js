// File: style3/khung_kt_team.js

if (typeof ALL_FRAMES === 'undefined') {
    var ALL_FRAMES = [];
}

ALL_FRAMES.push({ 
    id: 'f_kt_team', 
    type: 3, 
    name: 'Kiểm Nghiệm TEAM', 
    src: 'style3/KN.png', // Hãy đảm bảo bạn đã tải file KT.png vào thư mục style3
    layout: {
        canvasW: 807, canvasH: 2400,
        photos: [
            { x: 96, y: 104, w: 615, h: 460, angle: 0 },
            { x: 147, y: 763, w: 513, h: 448, angle: 7 }, // Ảnh giữa được xoay nghiêng 7 độ
            { x: 96, y: 1429, w: 615, h: 460, angle: 0 }
        ]
    }
});
