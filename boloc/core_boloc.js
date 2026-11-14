// File: boloc/core_boloc.js

var ALL_FILTERS = [];
let currentActiveFilter = null; 

function renderFilterPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let html = `<h3 class="text-pink-500 font-bold mb-2 text-sm px-4 mt-6">Bộ lọc & Làm đẹp</h3>
                <div class="flex gap-4 overflow-x-auto pb-2 pt-1 px-4 snap-x scroll-smooth">`;
    
    ALL_FILTERS.forEach((f, idx) => {
        const isSelected = idx === 0;
        if(isSelected) currentActiveFilter = f; // Gán bộ lọc đầu tiên làm mặc định

        html += `
            <button onclick="selectFilter('${f.id}', this)" class="filter-btn flex flex-col items-center gap-2 snap-start flex-shrink-0 group ${isSelected ? '' : 'opacity-70'} transition-opacity">
                <div class="w-[60px] h-[60px] rounded-full overflow-hidden shadow-${isSelected ? 'md' : 'sm'} ring-${isSelected ? '4' : '0'} ring-pink-400 p-0 transition-all duration-200">
                    <img src="${f.icon}" class="w-full h-full object-cover" alt="${f.name}">
                </div>
                <span class="text-[10px] font-${isSelected ? 'bold' : 'medium'} text-${isSelected ? 'pink-500' : 'gray-500'}">${f.name}</span>
            </button>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;
}

function selectFilter(filterId, btnElement) {
    currentActiveFilter = ALL_FILTERS.find(f => f.id === filterId);
    
    const allBtns = document.querySelectorAll('.filter-btn');
    allBtns.forEach(btn => {
        btn.classList.add('opacity-70');
        const imgContainer = btn.querySelector('div');
        imgContainer.classList.remove('ring-4', 'shadow-md');
        imgContainer.classList.add('ring-0', 'shadow-sm');
        btn.querySelector('span').classList.remove('text-pink-500', 'font-bold');
        btn.querySelector('span').classList.add('text-gray-500', 'font-medium');
    });

    btnElement.classList.remove('opacity-70');
    const targetImgContainer = btnElement.querySelector('div');
    targetImgContainer.classList.remove('ring-0', 'shadow-sm');
    targetImgContainer.classList.add('ring-4', 'shadow-md');
    btnElement.querySelector('span').classList.remove('text-gray-500', 'font-medium');
    btnElement.querySelector('span').classList.add('text-pink-500', 'font-bold');
    
    btnElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}
