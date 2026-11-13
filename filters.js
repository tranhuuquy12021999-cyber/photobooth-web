let activeFilterClass = 'filter-normal';
let activeFilterCSSString = 'brightness(1.05) blur(0.5px)';

const colorFilters = [
    { class: 'filter-normal', name: 'Mặc định', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop' },
    { class: 'filter-wedding', name: 'Tone trắng', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop' },
    { class: 'filter-korean', name: 'Trắng Hồng', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop' },
    { class: 'filter-hk', name: 'Hồng Kông', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop' },
    { class: 'filter-fuji', name: 'Fujifilm', img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop' }
];

function renderFilterPanel(containerId) {
    const container = document.getElementById(containerId);
    if(!container) return;
    let html = `<h3 class="text-pink-500 font-bold mb-3 text-sm px-4 mt-8">Bộ lọc & Làm đẹp</h3><div class="flex gap-4 overflow-x-auto pb-4 px-4 snap-x">`;
    colorFilters.forEach((f, idx) => {
        const isSelected = idx === 0;
        html += `
            <button onclick="applyColorFilter('${f.class}', this)" class="filter-btn flex flex-col items-center gap-2 snap-start flex-shrink-0 group ${isSelected ? '' : 'opacity-70'}">
                <div class="w-16 h-16 rounded-full overflow-hidden shadow-${isSelected ? 'md' : 'sm'} ring-${isSelected ? '4' : '0'} ring-pink-400 p-0 transition-all duration-200">
                    <img src="${f.img}" class="w-full h-full object-cover ${f.class}">
                </div>
                <span class="text-[10px] font-${isSelected ? 'bold' : 'medium'} text-${isSelected ? 'pink-500' : 'gray-500'}">${f.name}</span>
            </button>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}

function applyColorFilter(filterClass, btnElement) {
    const video = document.getElementById('camera');
    if(video) video.className = filterClass;
    activeFilterClass = filterClass;
    const tempDiv = document.createElement('div'); tempDiv.className = filterClass; document.body.appendChild(tempDiv);
    activeFilterCSSString = getComputedStyle(tempDiv).filter; document.body.removeChild(tempDiv);

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.add('opacity-70');
        btn.querySelector('div').classList.replace('ring-4', 'ring-0');
        btn.querySelector('span').classList.replace('text-pink-500', 'text-gray-500');
        btn.querySelector('span').classList.replace('font-bold', 'font-medium');
    });
    btnElement.classList.remove('opacity-70');
    btnElement.querySelector('div').classList.replace('ring-0', 'ring-4');
    btnElement.querySelector('span').classList.replace('text-gray-500', 'text-pink-500');
    btnElement.querySelector('span').classList.replace('font-medium', 'font-bold');
    btnElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}
