const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, 'participants-' + Date.now() + '.csv')
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только CSV файлы'));
    }
  }
});

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let participants = [
  { id: 1, lastName: "Иванов", firstName: "Иван", middleName: "Иванович", squad: "1" },
  { id: 2, lastName: "Петров", firstName: "Петр", middleName: "Петрович", squad: "2" },
  { id: 3, lastName: "Сидоров", firstName: "Алексей", middleName: "Николаевич", squad: "1" },
  { id: 4, lastName: "Кузнецова", firstName: "Мария", middleName: "Сергеевна", squad: "3" },
  { id: 5, lastName: "Смирнов", firstName: "Дмитрий", middleName: "Владимирович", squad: "2" }
];

let usedSquads = new Set();
let remainingParticipants = [...participants];
let spinHistory = [];

function parseCSVFile(filePath, append = false) {
  return new Promise((resolve, reject) => {
    const results = [];
    let idCounter = append && participants.length > 0 ? Math.max(...participants.map(p => p.id)) + 1 : 1;
    
    fs.createReadStream(filePath)
      .pipe(csv({ 
        separator: ';',
        headers: ['lastName', 'firstName', 'middleName', 'squad'],
        skipEmptyLines: true 
      }))
      .on('data', (data) => {
        if (data.lastName && data.firstName && data.middleName && data.squad) {
          results.push({
            id: idCounter++,
            lastName: data.lastName.trim(),
            firstName: data.firstName.trim(),
            middleName: data.middleName.trim(),
            squad: data.squad.trim()
          });
        }
      })
      .on('end', () => {
        fs.unlinkSync(filePath);
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

function getPossibleSquadCounts(totalParticipants) {
  const possibleCounts = [];
  for (let i = 2; i <= Math.min(10, totalParticipants); i++) {
    if (totalParticipants % i === 0) {
      possibleCounts.push(i);
    }
  }
  return possibleCounts;
}

function redistributeSquads(participants, squadCount) {
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const participantsPerSquad = shuffled.length / squadCount;
  const newParticipants = [];
  
  let participantIndex = 0;
  for (let squadNum = 1; squadNum <= squadCount; squadNum++) {
    for (let i = 0; i < participantsPerSquad; i++) {
      if (participantIndex < shuffled.length) {
        newParticipants.push({
          ...shuffled[participantIndex],
          squad: squadNum.toString()
        });
        participantIndex++;
      }
    }
  }
  
  return newParticipants;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/participants', (req, res) => {
  res.json(participants);
});

app.get('/used-squads', (req, res) => {
  res.json(Array.from(usedSquads));
});

app.get('/possible-squads', (req, res) => {
  const possibleCounts = getPossibleSquadCounts(participants.length);
  res.json({ possibleCounts });
});

app.post('/redistribute-squads', (req, res) => {
  try {
    const { squadCount } = req.body;
    
    if (!squadCount || squadCount < 2 || squadCount > 10) {
      return res.status(400).json({ error: 'Некорректное количество отрядов' });
    }
    
    if (participants.length % squadCount !== 0) {
      return res.status(400).json({ error: 'Невозможно равномерно распределить участников' });
    }
    
    const newParticipants = redistributeSquads(participants, squadCount);
    participants = newParticipants;
    usedSquads.clear();
    remainingParticipants = [...participants];
    spinHistory = [];
    
    io.emit('squadsRedistributed', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads),
      spinHistory: spinHistory
    });
    
    res.json({ 
      success: true, 
      message: `Участники перераспределены в ${squadCount} отрядов`,
      participants: newParticipants 
    });
    
  } catch (error) {
    console.error('Ошибка при перераспределении:', error);
    res.status(500).json({ error: 'Ошибка при перераспределении отрядов' });
  }
});

app.post('/update-participant-squad', (req, res) => {
  try {
    const { participantId, newSquad } = req.body;
    
    if (!participantId || !newSquad) {
      return res.status(400).json({ error: 'Не указаны ID участника или новый отряд' });
    }
    
    const participantIndex = participants.findIndex(p => p.id == participantId);
    if (participantIndex === -1) {
      return res.status(404).json({ error: 'Участник не найден' });
    }
    
    participants[participantIndex].squad = newSquad.toString();
    
    const remainingIndex = remainingParticipants.findIndex(p => p.id == participantId);
    if (remainingIndex !== -1) {
      remainingParticipants[remainingIndex].squad = newSquad.toString();
    }
    
    io.emit('participantUpdated', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads)
    });
    
    res.json({ 
      success: true, 
      message: 'Отряд участника обновлен',
      participant: participants[participantIndex]
    });
    
  } catch (error) {
    console.error('Ошибка при обновлении участника:', error);
    res.status(500).json({ error: 'Ошибка при обновлении отряда участника' });
  }
});

app.post('/add-participant', (req, res) => {
  try {
    const { lastName, firstName, middleName, squad } = req.body;
    
    if (!lastName || !firstName || !middleName || !squad) {
      return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    const newId = participants.length > 0 ? Math.max(...participants.map(p => p.id)) + 1 : 1;
    const newParticipant = {
      id: newId,
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      squad: squad.toString()
    };
    
    participants.push(newParticipant);
    remainingParticipants.push(newParticipant);
    
    io.emit('participantAdded', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads)
    });
    
    res.json({ 
      success: true, 
      message: 'Участник успешно добавлен',
      participant: newParticipant
    });
    
  } catch (error) {
    console.error('Ошибка при добавлении участника:', error);
    res.status(500).json({ error: 'Ошибка при добавлении участника' });
  }
});

app.delete('/participant/:id', (req, res) => {
  try {
    const participantId = parseInt(req.params.id);
    
    participants = participants.filter(p => p.id !== participantId);
    remainingParticipants = remainingParticipants.filter(p => p.id !== participantId);
    
    io.emit('participantDeleted', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads)
    });
    
    res.json({ 
      success: true, 
      message: 'Участник успешно удален'
    });
    
  } catch (error) {
    console.error('Ошибка при удалении участника:', error);
    res.status(500).json({ error: 'Ошибка при удалении участника' });
  }
});

app.post('/upload', upload.single('participantsFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }

    const append = req.body.append === 'true';
    const newParticipants = await parseCSVFile(req.file.path, append);
    
    if (newParticipants.length === 0) {
      return res.status(400).json({ error: 'Файл не содержит валидных данных' });
    }

    if (append) {
      participants = [...participants, ...newParticipants];
    } else {
      participants = newParticipants;
    }
    
    usedSquads.clear();
    remainingParticipants = [...participants];
    spinHistory = [];

    io.emit('dataUpdated', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads),
      spinHistory: spinHistory
    });

    res.json({ 
      success: true, 
      message: append ? 
        `Добавлено ${newParticipants.length} участников (всего: ${participants.length})` :
        `Загружено ${newParticipants.length} участников`,
      participants: participants 
    });

  } catch (error) {
    console.error('Ошибка при обработке файла:', error);
    res.status(500).json({ error: 'Ошибка при обработке файла' });
  }
});

app.get('/export-csv', (req, res) => {
  try {
    const csvData = participants.map(p => 
      `${p.lastName};${p.firstName};${p.middleName};${p.squad}`
    ).join('\n');
    
    const filename = `participants-export-${new Date().toISOString().split('T')[0]}.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.send(csvData);
    
  } catch (error) {
    console.error('Ошибка при экспорте CSV:', error);
    res.status(500).json({ error: 'Ошибка при экспорте данных' });
  }
});

app.post('/reset-used-squads', (req, res) => {
  try {
    usedSquads.clear();
    remainingParticipants = [...participants];
    
    io.emit('usedSquadsReset', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads)
    });
    
    res.json({ 
      success: true, 
      message: 'Исключенные отряды сброшены'
    });
    
  } catch (error) {
    console.error('Ошибка при сбросе отрядов:', error);
    res.status(500).json({ error: 'Ошибка при сбросе исключенных отрядов' });
  }
});

io.on('connection', (socket) => {
  console.log('Новое подключение');

  socket.emit('initialData', {
    participants: remainingParticipants,
    usedSquads: Array.from(usedSquads),
    spinHistory: spinHistory
  });

  socket.on('spin', () => {
    if (remainingParticipants.length === 0) {
      socket.emit('error', 'Все участники уже были выбраны!');
      return;
    }

    let counter = 0;
    const totalIterations = 40;
    let currentDelay = 80;
    
    const spinInterval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * remainingParticipants.length);
      const currentPerson = remainingParticipants[randomIndex];
      
      socket.emit('spinning', {
        person: currentPerson,
        progress: (counter / totalIterations) * 100,
        iteration: counter
      });
      
      counter++;
      
      if (counter > totalIterations * 0.7) {
        currentDelay += 10;
      }
      
      if (counter >= totalIterations) {
        clearInterval(spinInterval);
        
        const winnerIndex = Math.floor(Math.random() * remainingParticipants.length);
        const winner = remainingParticipants[winnerIndex];
        usedSquads.add(winner.squad);
        
        spinHistory.unshift({
          winner: winner,
          timestamp: new Date().toLocaleTimeString(),
          remaining: remainingParticipants.length - 1
        });
        
        remainingParticipants = remainingParticipants.filter(p => p.squad !== winner.squad);
        
        socket.emit('result', {
          winner,
          remainingParticipants,
          usedSquads: Array.from(usedSquads),
          spinHistory: spinHistory.slice(0, 10)
        });

        io.emit('usedSquadsUpdated', Array.from(usedSquads));
      }
    }, currentDelay);
  });

  socket.on('reset', () => {
    usedSquads.clear();
    remainingParticipants = [...participants];
    spinHistory = [];
    
    io.emit('resetData', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads),
      spinHistory: spinHistory
    });

    io.emit('usedSquadsUpdated', Array.from(usedSquads));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});