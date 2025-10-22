const socket = io();
let allParticipants = [];
let maxSquads = 10;
let updateTimer = null;

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(sectionId).classList.add('active');
    event.target.classList.add('active');
    
    if (sectionId === 'dragdrop') {
        renderSquadsDragDrop();
    } else if (sectionId === 'redistribute') {
        updateDistributionInfo();
    }
}

function handleDataUpdate(data) {
    allParticipants = data.participants;
    updateStats();
    renderAllParticipants();
    renderSquadsDragDrop();
    renderExcludedSquads(data.usedSquads);
    updateDistributionInfo();
}

function startUpdateTimer(interval) {
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    
    const seconds = interval / 1000;
    document.getElementById('updateInterval').textContent = seconds;
    console.log(`Админ: автообновление каждые ${seconds} секунд`);
}

// Socket event handlers
socket.on('updateInterval', (interval) => {
    startUpdateTimer(interval);
});

socket.on('dataUpdate', (data) => {
    handleDataUpdate(data);
});

socket.on('initialData', (data) => {
    handleDataUpdate(data);
    
    // Получаем максимальное количество отрядов
    fetch('/possible-squads')
        .then(response => response.json())
        .then(squadsData => {
            const possibleCounts = squadsData.possibleCounts;
            maxSquads = possibleCounts.length > 0 ? Math.max(...possibleCounts) : 10;
            
            // Обновляем UI
            document.getElementById('maxSquads').textContent = maxSquads;
            document.getElementById('maxSquadsCount').textContent = maxSquads;
            
            const squadSelect = document.getElementById('squadCount');
            squadSelect.innerHTML = '<option value="">-- Выберите количество --</option>';
            
            possibleCounts.forEach(count => {
                const option = document.createElement('option');
                option.value = count;
                const participantsPerSquad = Math.floor(allParticipants.length / count);
                const remainder = allParticipants.length % count;
                let description = `${count} отрядов`;
                if (remainder === 0) {
                    description += ` (по ${participantsPerSquad} человек)`;
                } else {
                    description += ` (по ${participantsPerSquad} человек + ${remainder} в последнем)`;
                }
                option.textContent = description;
                squadSelect.appendChild(option);
            });
            
            squadSelect.addEventListener('change', updateDistributionInfo);
        });
});

// Остальные функции админ-панели (uploadFile, redistributeSquads, renderAllParticipants и т.д.)
// ... они будут аналогичны предыдущей версии, но используют handleDataUpdate