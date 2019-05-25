// Dependencies
var express = require('express');
var http = require('http');
var path = require('path');
var socketIO = require('socket.io');
var app = express();
var server = http.Server(app);
var io = socketIO(server);
app.set('port', 5000);
app.use('/static', express.static(__dirname + '/static'));
// Routing
app.get('/', function(request, response) {
    response.sendFile(path.join(__dirname, 'index.html'));
});

var fs = require('fs');
let world_json = JSON.parse(fs.readFileSync('./world.json', 'utf8'));

// Starts the server.
server.listen(5000, function() {
    console.log('Starting server on port 5000');
});
// Add the WebSocket handlers

function isAlphaNumeric(str) {
    var code, i, len;

    for (i = 0, len = str.length; i < len; i++) {
        code = str.charCodeAt(i);
        if (!(code > 47 && code < 58) && // numeric (0-9)
            !(code > 64 && code < 91) && // upper alpha (A-Z)
            !(code > 96 && code < 123)) { // lower alpha (a-z)
            return false;
        }
    }
    return true;
};


const DIRECTIONS = {
    'EAST':{x:1, y:0, z: 0},
    'WEST':{x:-1, y:0, z: 0},
    'UP':{x:0, y:1, z: 0},
    'DOWN':{x:0, y:-1, z: 0},
    'NORTH':{x:0, y:0, z: 1},
    'SOUTH':{x:0, y:0, z: -1}
};
let playerdata = {};
let socket_to_username = new Map();
let rooms = {};

function validDirections(loc){
    valid_moves = {};
    for (let dir in DIRECTIONS) {
        vector = DIRECTIONS[dir];
        new_loc = {x: vector['x'] + loc['x'], y: vector['y'] + loc['y'], z: vector['z'] + loc['z']};
        if (locToString(new_loc) in world_json) {
                   valid_moves[dir] = new_loc;
        }
    }
    return valid_moves;
}

function locToString(loc) {
    if (loc === undefined) { return undefined};
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
    let session_user = ''
    function getSession(data){
        let username = data.username;
        let session_id = data.session_id;
        if (!isAlphaNumeric(username)
            || username === "SERVER"
            || username === "LOG"
            || !(username in playerdata) || playerdata[username]['session_id'] !== session_id) {
            //socket.disconnect(true);
            return null;
        }
        return playerdata[username];
    }
    socket.on('login', function(data) {
        let username = data.username;
        let session_id = data.session_id;
        if (!(username in playerdata) || playerdata[username] === undefined) {
            let new_player = {}
            new_player['session_id'] = session_id;
            new_player['room'] = {x:0, y:0, z:0};
            new_player['username'] = username;
            playerdata[username] = new_player
        }
        if (playerdata[username]['session_id'] !== session_id) {
            return;
        }
        playerdata[username]['socket'] = socket;
        session_user = playerdata[username];
        enter_room(playerdata[username], playerdata[username].room);
        console.log("Established connection with " + username);
    });
    socket.on('disconnect', function() {
        if( getUsersInRoom(session_user.room).includes(session_user.username)) {
            send_all_in_room(session_user.room, "SERVER", session_user.username + " left the room.");
            send_all_in_room_packet(session_user.room, "room_left", {member: session_user.username});
            delMember(session_user.room, session_user.username);
        }
    });

    socket.on('message', function(data) {
        let player = getSession(data);
        if(player === null) { return; }
        if (!data.hasOwnProperty('message') || data.message.length === 0) { return; }
        let args = data.message.split(" ");

        switch (args[0].toLowerCase()){
            case 'help':
                command_help(player, args);
                break;
            case 'say':
                if (args.length < 2) { return; }
                command_say(player, args);
                break;
            case 'yell':
                if (args.length < 2) { return; }
                command_yell(player, args);
                break;
            case 'north':
            case 'south':
            case 'east':
            case 'west':
            case 'up':
            case 'down':
                command_move(player, args);
                break;
        }
    });

    function command_help(user, args) {
        let helps = ['help: Gives list of commands and usages.',
            'yell: Sends message to all players currently connected.',
            'say: Sends message to all players in current room',
            '<direction>: moves player to room in that direction'];
        socket.emit('message', {sender: 'LOG', body: helps.join('\n')});
    }
    function command_yell(user, args) {
        let message = args.slice(1).join(" ");
        for  (let username in playerdata) {
            let sock = playerdata[username].socket;
            sock.emit('message', {sender: user.username, body: message});
        }
    };

    function command_move(user, args){
        let dir = args[0].toUpperCase();
        let valid_moves = validDirections(user.room);
        if (dir in valid_moves){
            enter_room(user, valid_moves[dir]);
        } else {
            socket.emit('message', {sender: 'LOG', body: 'Invalid Move'});
        }
    }

    function command_say(user, args){
        let message = args.slice(1).join(" ");
        let users = getUsersInRoom(user.room);
        for  (let i in users) {
            let username = users[i];
            let sock = playerdata[username].socket;
            sock.emit('message', {sender: user.username, body: message});
        }
    }

    //Directly moves user to a room, only called from initial login or other commands
    function enter_room(user, location) {
        if( getUsersInRoom(user.room).includes(user.username)) {
            send_all_in_room(user.room, "SERVER", user.username + " left the room.");
            send_all_in_room_packet(user.room, "room_left", {member: user.username});
            delMember(user.room, user.username);
        }
        user.room = location;
        socket.emit('room_enter', {
            members:getUsersInRoom(user.room),
            label:world_json[locToString(user.room)]['label'],
            location: user.room,
            description:world_json[locToString(user.room)]['description'],
            directions: validDirections(user.room)
        });
        addMember(location, user.username);
        send_all_in_room_packet(user.room, "room_join", {member: user.username});
        send_all_in_room(user.room, "SERVER", user.username + " entered the room.");

    }
    function send_all_in_room(room, sender, message) {
        let users = getUsersInRoom(room);
        for  (let i in users) {
            let username = users[i];
            let sock = playerdata[username].socket;
            sock.emit('message', {sender: sender, body: message});
        }
    }
    function send_all_in_room_packet(room, tag, data) {
        let users = getUsersInRoom(room);
        for  (let i in users) {
            let username = users[i];
            let sock = playerdata[username].socket;
            sock.emit(tag, data);
        }
    }
});