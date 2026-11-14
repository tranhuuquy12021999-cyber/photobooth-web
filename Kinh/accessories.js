// File: Kinh/accessories.js

let currentAccessorySrc = null;
let currentAccessoryType = 'none'; // 'glass' hoặc 'hat'
const accessoryImgElement = new Image();

// Dữ liệu phụ kiện (Bạn có thể thêm bớt tùy ý)
const accessoriesData = {
    glasses: [
        { id: 'g1', src: 'Kinh/kinh1.png' },
        { id: 'g2', src: 'Kinh/kinh2.png' },
        { id: 'g3', src: 'Kinh/kinh3.png' }
    ],
    hats: [
        { id: 'm1', src: 'Kinh/mu1.png' },
        { id: 'm2', src: 'Kinh/mu2.png' }
    ]
};

// SVG Biểu tượng gạch chéo (Bỏ chọn)
const noneIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>`;

function renderAccessoryPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    
    // HÀNG 1: KÍNH
    html += `<h3 class="text-pink-500 font-bold mb-2 text-sm px-4 mt-6">Kính</h3>`;
    html += `<div class="flex items-center px-4 mb-4">
                <!-- Ô Không chọn cố định -->
                <button onclick="selectAccessory('none', null, this)" class="acc-btn w-14 h-14 bg-gray-50 border-2 border-pink-400 rounded-lg flex items-center justify-center flex-shrink-0 mr-3 shadow-sm transition">
                    ${noneIconSvg}
                </button>
                <!-- Danh sách Kính cuộn ngang -->
                <div class="flex gap-3 overflow-x-auto pb-2 snap-x scroll-smooth flex-1">`;
    accessoriesData.glasses.forEach(acc => {
        html += `<button onclick="selectAccessory('glass', '${acc.src}', this)" class="acc-btn w-14 h-14 bg-white border-2 border-transparent rounded-lg flex items-center justify-center flex-shrink-0 snap-start shadow-sm hover:bg-pink-50 transition p-1">
                    <img src="${acc.src}" class="max-w-full max-h-full object-contain drop-shadow-sm">
                 </button>`;
    });
    html += `   </div>
             </div>`;

    // HÀNG 2: MŨ
    html += `<h3 class="text-pink-500 font-bold mb-2 text-sm px-4">Mũ</h3>`;
    html += `<div class="flex items-center px-4 pb-4">
                <button onclick="selectAccessory('none', null, this)" class="acc-btn w-14 h-14 bg-gray-50 border-2 border-transparent rounded-lg flex items-center justify-center flex-shrink-0 mr-3 shadow-sm transition">
                    ${noneIconSvg}
                </button>
                <div class="flex gap-3 overflow-x-auto pb-2 snap-x scroll-smooth flex-1">`;
    accessoriesData.hats.forEach(acc => {
        html += `<button onclick="selectAccessory('hat', '${acc.src}', this)" class="acc-btn w-14 h-14 bg-white border-2 border-transparent rounded-lg flex items-center justify-center flex-shrink-0 snap-start shadow-sm hover:bg-pink-50 transition p-1">
                    <img src="${acc.src}" class="max-w-full max-h-full object-contain drop-shadow-sm">
                 </button>`;
    });
    html += `   </div>
             </div>`;

    container.innerHTML = html;
}

function selectAccessory(type, src, btnElement) {
    // Cập nhật logic AI
    currentAccessoryType = type;
    if (src) {
        currentAccessorySrc = src;
        accessoryImgElement.src = src;
    } else {
        currentAccessorySrc = null;
    }

    // Xóa viền màu hồng vuông ở tất cả các nút
    document.querySelectorAll('.acc-btn').forEach(btn => {
        btn.classList.remove('border-pink-400');
        btn.classList.add('border-transparent');
    });

    // Thêm viền vuông màu hồng cho nút vừa chọn
    btnElement.classList.remove('border-transparent');
    btnElement.classList.add('border-pink-400');
}
