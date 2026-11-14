// // File: Kinh/kinh.js

const glassesList = [
    { id: 'k1', src: 'Kinh/kinh1.png' },
    { id: 'k2', src: 'Kinh/kinh2.png' },
    { id: 'k1', src: 'Kinh/kinh4.png' },
    { id: 'k1', src: 'Kinh/kinh5.png' },
    { id: 'k1', src: 'Kinh/kinh6.png' },
    { id: 'k1', src: 'Kinh/kinh7.png' },
    { id: 'k3', src: 'Kinh/kinh3.png' }
];

function renderGlassesPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Đã tăng icon hủy bỏ cho to và cân đối
    const noneIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>`;
    
    // Tăng kích thước nút bấm thành w-[72px] h-[72px]
    let html = `<h3 class="text-pink-500 font-bold mb-2 text-sm px-4 mt-6">Kính</h3>
                <div class="flex items-center px-4 mb-4">
                    <button onclick="selectAccessory('none', null, this)" class="acc-btn w-[72px] h-[72px] bg-gray-50 border-2 border-pink-400 rounded-xl flex items-center justify-center flex-shrink-0 mr-3 shadow-sm transition">${noneIcon}</button>
                    <div class="flex gap-3 overflow-x-auto pb-2 snap-x scroll-smooth flex-1">`;
    glassesList.forEach(acc => {
        html += `<button onclick="selectAccessory('glass', '${acc.src}', this)" class="acc-btn w-[72px] h-[72px] bg-white border-2 border-transparent rounded-xl flex items-center justify-center flex-shrink-0 snap-start shadow-sm hover:bg-pink-50 transition p-2">
                    <img src="${acc.src}" class="max-w-full max-h-full object-contain drop-shadow-sm">
                 </button>`;
    });
    html += `</div></div>`;
    container.innerHTML = html;
}File: Kinh/kinh.js


