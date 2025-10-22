const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const basicAuth = require('basic-auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware для проверки аутентификации
const auth = (req, res, next) => {
  const user = basicAuth(req);
  const username = process.env.fortune_login;
  const password = process.env.fortune_password;
  
  if (!username || !password) {
    return next();
  }
  
  if (!user || user.name !== username || user.pass !== password) {
    res.set('WWW-Authenticate', 'Basic realm="Fortune Wheel Admin"');
    return res.status(401).send('Требуется авторизация');
  }
  
  next();
};

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
let updateInterval = null;

// Функция для получения интервала обновления
function getUpdateInterval() {
  const updateFromEnv = process.env.fortune_update;
  return updateFromEnv ? parseInt(updateFromEnv) * 1000 : 5000;
}

// Функция для получения максимального количества отрядов
function getMaxSquadsCount() {
  const maxFromEnv = process.env.fortune_count;
  return maxFromEnv ? parseInt(maxFromEnv) : 10;
}

function getAllSquads() {
  return [...new Set(participants.map(p => p.squad))];
}

function getRemainingSquadsCount() {
  const allSquads = getAllSquads();
  return allSquads.filter(squad => !usedSquads.has(squad)).length;
}

function parseCSVFile(filePath, append = false) {
  return new Promise((resolve, reject) => {
    const results = [];
    let idCounter = append && participants.length > 0 ? Math.max(...participants.map(p => p.id)) + 1 : 1;
    
    let separator = ';';
    let fileContent = fs.readFileSync(filePath, 'utf8');
    
    if (fileContent.includes(',') && !fileContent.includes(';')) {
      separator = ',';
    } else if (fileContent.includes(';')) {
      separator = ';';
    } else if (fileContent.includes('\t')) {
      separator = '\t';
    }
    
    fs.createReadStream(filePath)
      .pipe(csv({ 
        separator: separator,
        headers: false,
        skipEmptyLines: true 
      }))
      .on('data', (data) => {
        const values = Object.values(data);
        
        if (values.length >= 3) {
          const lastName = values[0] ? values[0].trim() : '';
          const firstName = values[1] ? values[1].trim() : '';
          const middleName = values[2] ? values[2].trim() : '';
          
          let squad = "9";
          if (values.length >= 4 && values[3]) {
            const squadValue = values[3].trim();
            if (squadValue && !isNaN(squadValue) && squadValue !== '') {
              squad = squadValue;
            }
          }
          
          if (lastName && firstName && middleName) {
            results.push({
              id: idCounter++,
              lastName: lastName,
              firstName: firstName,
              middleName: middleName,
              squad: squad
            });
          }
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
  const maxSquads = Math.min(getMaxSquadsCount(), totalParticipants);
  
  for (let i = 1; i <= maxSquads; i++) {
    possibleCounts.push(i);
  }
  return possibleCounts;
}

function redistributeSquads(participants, squadCount) {
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const baseParticipantsPerSquad = Math.floor(shuffled.length / squadCount);
  const remainder = shuffled.length % squadCount;
  
  const newParticipants = [];
  let participantIndex = 0;
  
  for (let squadNum = 1; squadNum <= squadCount; squadNum++) {
    const participantsInThisSquad = squadNum === squadCount ? 
      baseParticipantsPerSquad + remainder : baseParticipantsPerSquad;
    
    for (let i = 0; i < participantsInThisSquad; i++) {
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

function broadcastData() {
  io.emit('dataUpdate', {
    participants: remainingParticipants,
    usedSquads: Array.from(usedSquads),
    spinHistory: spinHistory,
    remainingSquads: getRemainingSquadsCount()
  });
}

function startUpdateInterval() {
  const interval = getUpdateInterval();
  
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  
  updateInterval = setInterval(() => {
    broadcastData();
  }, interval);
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/info', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'info.html'));
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

app.get('/update-interval', (req, res) => {
  res.json({ interval: getUpdateInterval() });
});

app.post('/redistribute-squads', (req, res) => {
  try {
    const { squadCount } = req.body;
    const maxSquads = getMaxSquadsCount();
    
    if (!squadCount || squadCount < 1 || squadCount > maxSquads) {
      return res.status(400).json({ error: `Некорректное количество отрядов. Допустимо от 1 до ${maxSquads}` });
    }
    
    const actualSquadCount = Math.min(squadCount, participants.length);
    const newParticipants = redistributeSquads(participants, actualSquadCount);
    participants = newParticipants;
    usedSquads.clear();
    remainingParticipants = [...participants];
    spinHistory = [];
    
    io.emit('squadsRedistributed', {
      participants: remainingParticipants,
      usedSquads: Array.from(usedSquads),
      spinHistory: spinHistory,
      remainingSquads: getRemainingSquadsCount()
    });
    
    res.json({ 
      success: true, 
      message: `Участники перераспределены в ${actualSquadCount} отрядов`,
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
      usedSquads: Array.from(usedSquads),
      remainingSquads: getRemainingSquadsCount()
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
      usedSquads: Array.from(usedSquads),
      remainingSquads: getRemainingSquadsCount()
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
      usedSquads: Array.from(usedSquads),
      remainingSquads: getRemainingSquadsCount()
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
      spinHistory: spinHistory,
      remainingSquads: getRemainingSquadsCount()
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
      usedSquads: Array.from(usedSquads),
      remainingSquads: getRemainingSquadsCount()
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

// Socket.io
io.on('connection', (socket) => {
  console.log('Новое подключение');

  socket.emit('updateInterval', getUpdateInterval());

  socket.emit('initialData', {
    participants: remainingParticipants,
    usedSquads: Array.from(usedSquads),
    spinHistory: spinHistory,
    remainingSquads: getRemainingSquadsCount()
  });

  socket.on('spin', () => {
    const remainingSquadsCount = getRemainingSquadsCount();
    if (remainingSquadsCount === 0) {
      socket.emit('error', 'Все отряды уже были выбраны!');
      return;
    }

    const availableSquads = getAllSquads().filter(squad => !usedSquads.has(squad));
    
    let counter = 0;
    const totalIterations = 40;
    let currentDelay = 80;
    
    const spinInterval = setInterval(() => {
      const availableParticipants = remainingParticipants.filter(p => availableSquads.includes(p.squad));
      const randomIndex = Math.floor(Math.random() * availableParticipants.length);
      const currentPerson = availableParticipants[randomIndex];
      
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
        
        const winnerIndex = Math.floor(Math.random() * availableParticipants.length);
        const winner = availableParticipants[winnerIndex];
        usedSquads.add(winner.squad);
        
        remainingParticipants = remainingParticipants.filter(p => p.squad !== winner.squad);
        
        const remainingSquadsAfter = getRemainingSquadsCount();
        
        spinHistory.unshift({
          winner: winner,
          timestamp: new Date().toLocaleTimeString(),
          remaining: remainingSquadsAfter
        });
        
        socket.emit('result', {
          winner,
          remainingParticipants,
          usedSquads: Array.from(usedSquads),
          spinHistory: spinHistory.slice(0, 10),
          remainingSquads: remainingSquadsAfter
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
      spinHistory: spinHistory,
      remainingSquads: getRemainingSquadsCount()
    });

    io.emit('usedSquadsUpdated', Array.from(usedSquads));
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Максимальное количество отрядов: ${getMaxSquadsCount()}`);
  console.log(`Интервал обновления: ${getUpdateInterval() / 1000} секунд`);
  startUpdateInterval();
});