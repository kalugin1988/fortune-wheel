const socket = io();
let isSpinning = false;
let usedSquads = [];
let allParticipants = [];
let remainingParticipants = [];
let updateTimer = null;

function spinWheel() {
    if (isSpinning) return;
    
    isSpinning = true;
    document.getElementById('spinButton').disabled = true;
    document.getElementById('result').style.display = 'none';
    document.getElementById('progressFill').style.width = '0%';
    
    const spinBtn = document.getElementById('spinButton');
    spinBtn.classList.add('pulse');
    
    socket.emit('spin');
}

function resetWheel() {
    socket.emit('reset');
    createConfetti(30);
}

function goToAdmin() {
    window.location.href = '/admin';
}

function createConfetti(count) {
    for (let i = 0; i < count; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.background = getRandomColor();
        confetti.style.animation = `confettiFall ${Math.random() * 3 + 2}s linear forwards`;
        document.body.appendChild(confetti);
        
        setTimeout(() => {
            confetti.remove();
        }, 5000);
    }
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes confettiFall {
            0% { 
                opacity: 1;
                transform: translateY(-100px) rotate(0deg); 
            }
            100% { 
                opacity: 0;
                transform: translateY(100vh) rotate(360deg); 
            }
        }
    `;
    document.head.appendChild(style);
}

function getRandomColor() {
    const colors = ['#ffeb3b', '#4CAF50', '#2196F3', '#f44336', '#9C27B0', '#FF9800'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function playWinSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
        oscillator.stop(audioContext.currentTime + 1);
    } catch (e) {
        console.log('Web Audio API не поддерживается');
    }
}

function getRemainingSquadsCount(participants, usedSquads) {
    const allSquads = [...new Set(participants.map(p => p.squad))];
    const remainingSquads = allSquads.filter(squad => !usedSquads.includes(squad));
    return remainingSquads.length;
}

function handleDataUpdate(data) {
    allParticipants = data.participants;
    remainingParticipants = data.participants;
    usedSquads = data.usedSquads;
    updateStats();
    updateHistory(data.spinHistory);
}

function startUpdateTimer(interval) {
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    
    const seconds = interval / 1000;
    document.getElementById('updateInterval').textContent = seconds;
    console.log(`Автообновление каждые ${seconds} секунд`);
}

// Socket event handlers
socket.on('updateInterval', (interval) => {
    startUpdateTimer(interval);
});

socket.on('dataUpdate', (data) => {
    if (!isSpinning) {
        handleDataUpdate(data);
    }
});

socket.on('spinning', (data) => {
    const currentPersonEl = document.getElementById('currentPerson');
    const progressFill = document.getElementById('progressFill');
    
    currentPersonEl.innerHTML = 
        `<div class="spin-glow">
            <i class="fas fa-spinner fa-spin"></i><br>
            ${data.person.lastName} ${data.person.firstName} ${data.person.middleName}<br>
            <small>Отряд ${data.person.squad}</small>
        </div>`;
    
    progressFill.style.width = data.progress + '%';
    
    if (data.iteration % 5 === 0 && navigator.vibrate) {
        navigator.vibrate(50);
    }
});

socket.on('result', (data) => {
    isSpinning = false;
    remainingParticipants = data.remainingParticipants;
    usedSquads = data.usedSquads;
    
    updateStats();
    
    const remainingSquads = getRemainingSquadsCount(allParticipants, data.usedSquads);
    document.getElementById('spinButton').disabled = remainingSquads === 0;
    document.getElementById('spinButton').classList.remove('pulse');
    
    const resultEl = document.getElementById('result');
    resultEl.innerHTML = `
        <div class="winner-glow"></div>
        <i class="fas fa-trophy bounce" style="color: var(--accent);"></i><br>
        🎉 ПОБЕДИТЕЛЬ 🎉<br>
        <strong>${data.winner.lastName} ${data.winner.firstName} ${data.winner.middleName}</strong><br>
        <span style="font-size: 0.8em;">Отряд ${data.winner.squad}</span>
    `;
    resultEl.style.display = 'block';
    
    updateHistory(data.spinHistory);
    
    createConfetti(100);
    playWinSound();
});

socket.on('initialData', (data) => {
    handleDataUpdate(data);
});

socket.on('resetData', (data) => {
    handleDataUpdate(data);
    
    document.getElementById('result').style.display = 'none';
    document.getElementById('currentPerson').innerHTML = 
        '<i class="fas fa-play-circle"></i> Нажмите "Крутить колесо" для начала жеребьевки';
    document.getElementById('spinButton').disabled = false;
    document.getElementById('progressFill').style.width = '0%';
});

socket.on('dataUpdated', (data) => {
    handleDataUpdate(data);
    
    document.getElementById('result').style.display = 'none';
    document.getElementById('currentPerson').innerHTML = 
        '<i class="fas fa-play-circle"></i> Нажмите "Крутить колесо" для начала жеребьевки';
    document.getElementById('spinButton').disabled = false;
});

socket.on('error', (message) => {
    isSpinning = false;
    document.getElementById('spinButton').disabled = true;
    document.getElementById('spinButton').classList.remove('pulse');
    alert(message);
});

function updateHistory(history) {
    const historyListEl = document.getElementById('historyList');
    
    if (history.length === 0) {
        historyListEl.innerHTML = '<div class="history-item"><span>Жеребьевка еще не проводилась</span></div>';
    } else {
        historyListEl.innerHTML = history.map(item => 
            `<div class="history-item">
                <div>
                    <strong>${item.winner.lastName} ${item.winner.firstName}</strong><br>
                    <small>Отряд ${item.winner.squad} • ${item.timestamp}</small>
                </div>
                <div class="participant-squad">Осталось отрядов: ${item.remaining}</div>
            </div>`
        ).join('');
    }
    
    document.getElementById('spinsCount').textContent = history.length;
}

function updateStats() {
    const totalParticipants = allParticipants.length;
    const remainingSquads = getRemainingSquadsCount(allParticipants, usedSquads);
    
    document.getElementById('totalParticipants').textContent = totalParticipants;
    document.getElementById('remainingSquads').textContent = remainingSquads;
}

document.addEventListener('DOMContentLoaded', function() {
    createConfetti(30);
});