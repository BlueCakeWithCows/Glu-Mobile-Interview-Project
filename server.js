// Dependencies
const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const app = express();
const server = http.Server(app);
const io = socketIO(server);
app.set('port', 5000);
app.use('/static', express.static(__dirname + '/static'));
// Routing
app.get('/', function(request, response) {
    response.sendFile(path.join(__dirname, 'index.html'));
});

const fs = require('fs');
let worldJson = JSON.parse(fs.readFileSync('./world.json', 'utf8'));

// Starts the server.
server.listen(5000, function() {
    console.log('Starting server on port 5000');
});
// Add the WebSocket handlers
const DIRECTIONS = {
    'EAST':{x:1, y:0, z: 0},
    'WEST':{x:-1, y:0, z: 0},
    'UP':{x:0, y:1, z: 0},
    'DOWN':{x:0, y:-1, z: 0},
    'NORTH':{x:0, y:0, z: 1},
    'SOUTH':{x:0, y:0, z: -1}
};
let userMap = {};
let rooms = {};

function getLegalMoves(loc){
    let legalMoves = {};
    for (let dir in DIRECTIONS) {
        let vector = DIRECTIONS[dir];
        let newLoc = {x: vector['x'] + loc['x'], y: vector['y'] + loc['y'], z: vector['z'] + loc['z']};
        if (locToString(newLoc) in worldJson) {
            legalMoves[dir] = newLoc;
        }
    }
    return legalMoves;
}

function locToString(loc) {
    if (loc === undefined) {
        return undefined
    }
    return loc['x'] + "," + loc['y'] + "," + loc['z'];
}
function addMember(loc, username){
    let key = locToString(loc);
    rooms[key] = rooms[key] || [];
    if (!rooms[key].includes(username)) {
        rooms[key].push(username);
    }
}
function delMember(loc, username){
    if (loc === undefined || loc === null) { return; }
    let key = loc['x'] + "," + loc['y']+","+loc['z'];
    if (rooms[key].indexOf(username) !== -1) {
        rooms[key].splice(rooms[key].indexOf(username), 1);
    }
}
function getUsersInRoom(loc){
    return (rooms[locToString(loc)] || []);
}

io.on('connection', function(socket) {
    let sessionUser = '';
    function getSession(data){
        let username = data.username;
        let sessionID = data.session_id;
        if (username === "SERVER"
            || username === "LOG"
            || !(username in userMap) || userMap[username]['sessionID'] !== sessionID) {
            //socket.disconnect(true);
            return null;
        }
        return userMap[username];
    }
    socket.on('login', function(data) {
        let username = data.username;
        let sessionID = data.session_id;
        if (!(username in userMap) || userMap[username] === undefined) {
            let newUser = {};
            newUser['sessionID'] = sessionID;
            newUser['room'] = {x:0, y:0, z:0};
            newUser['username'] = username;
            userMap[username] = newUser
        }
        if (userMap[username]['sessionID'] !== sessionID) {
            return;
        }

        userMap[username]['socket'] = socket;
        sessionUser = userMap[username];
        enterRoom(userMap[username], userMap[username].room);
        console.log("Established connection with " + username);
    });
    socket.on('disconnect', function() {
        if( getUsersInRoom(sessionUser.room).includes(sessionUser.username)) {
            sendAllInRoomMessage(sessionUser.room, "SERVER", sessionUser.username + " left the room.");
            sendAllInRoomPacket(sessionUser.room, "room_left", {member: sessionUser.username});
            delMember(sessionUser.room, sessionUser.username);
        }
    });

    socket.on('message', function(data) {
        let player = getSession(data);
        if(player === null) { return; }
        if (!data.hasOwnProperty('message') || data.message.length === 0) { return; }
        let args = data.message.split(" ");

        switch (args[0].toLowerCase()){
            case 'help':
                commandHelp(player, args);
                break;
            case 'say':
                if (args.length < 2) { return; }
                commandSay(player, args);
                break;
            case 'yell':
                if (args.length < 2) { return; }
                commandYell(player, args);
                break;
            case 'north':
            case 'south':
            case 'east':
            case 'west':
            case 'up':
            case 'down':
                commandMove(player, args);
                break;
        }
    });

    // noinspection JSUnusedLocalSymbols
    function commandHelp(user, args) {
        // noinspection HtmlUnknownTag
        let helps = ['help: Gives list of commands and usages.',
            'yell: Sends message to all players currently connected.',
            'say: Sends message to all players in current room',
            '<direction>: moves player to room in that direction'];
        socket.emit('message', {sender: 'LOG', body: helps.join('\n')});
    }
    function commandYell(user, args) {
        let message = args.slice(1).join(" ");
        for  (let username in userMap) {
            let sock = userMap[username].socket;
            sock.emit('message', {sender: user.username, body: message});
        }
    }
    function commandMove(user, args){
        let dir = args[0].toUpperCase();
        let legalMoves = getLegalMoves(user.room);
        if (dir in legalMoves){
            enterRoom(user, legalMoves[dir]);
        } else {
            socket.emit('message', {sender: 'LOG', body: 'Invalid Move'});
        }
    }

    function commandSay(user, args){
        let message = args.slice(1).join(" ");
        let users = getUsersInRoom(user.room);
        for  (let i in users) {
            let username = users[i];
            let sock = userMap[username].socket;
            sock.emit('message', {sender: user.username, body: message});
        }
    }

    //Directly moves user to a room, only called from initial login or other commands
    function enterRoom(user, location) {
        if( getUsersInRoom(user.room).includes(user.username)) {
            sendAllInRoomMessage(user.room, "SERVER", user.username + " left the room.");
            sendAllInRoomPacket(user.room, "room_left", {member: user.username});
            delMember(user.room, user.username);
        }
        user.room = location;
        socket.emit('room_enter', {
            members:getUsersInRoom(user.room),
            label:worldJson[locToString(user.room)]['label'],
            location: user.room,
            description:worldJson[locToString(user.room)]['description'],
            directions: getLegalMoves(user.room)
        });
        addMember(location, user.username);
        sendAllInRoomPacket(user.room, "room_join", {member: user.username});
        sendAllInRoomMessage(user.room, "SERVER", user.username + " entered the room.");

    }
    function sendAllInRoomMessage(room, sender, message) {
        let users = getUsersInRoom(room);
        for  (let i in users) {
            let username = users[i];
            let sock = userMap[username].socket;
            sock.emit('message', {sender: sender, body: message});
        }
    }
    function sendAllInRoomPacket(room, tag, data) {
        let users = getUsersInRoom(room);
        for  (let i in users) {
            let username = users[i];
            let sock = userMap[username].socket;
            sock.emit(tag, data);
        }
    }
});