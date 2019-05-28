function setCookie(cname, cvalue, exdays = 10000) {
    let d = new Date();
    d.setTime(d.getTime() + (exdays*24*60*60*1000));
    let expires = "expires="+ d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}
function getCookie(cname) {
    let name = cname + "=";
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(';');
    for(let i = 0; i <ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) === 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

function checkCookie(name) {
    let username = getCookie(name);
    return username !== '';
}

//https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    )
}



const DOM = {
    room: document.querySelector('.room'),
    membersList: document.querySelector('.room-members'),
    messages: document.querySelector('.messages'),
    input: document.querySelector('.message-form__input'),
    form: document.querySelector('.message-form'),
};

let room = {label: '', description: '', location: '', directions: {}};
let members = [];

function createMemberElement(member) {
    const el = document.createElement('div');
    el.appendChild(document.createTextNode(member));
    el.className = 'member';
    return el;
}

function updateRoom() {
    //DOM.membersCount.innerText = `${members.length} users in room:`;
    DOM.room.innerHTML = '';
    DOM.room.appendChild(createMemberElement(room.label + ` (${room.location["x"]}, ${room.location["y"]}, ${room.location["z"]})`));
    DOM.room.appendChild(createMemberElement( `Directions: ${Object.keys(room.directions).join(", ")}` ));
    DOM.room.appendChild(document.createTextNode(room.description));
}

function updateMembersDOM() {
    //DOM.membersCount.innerText = `${members.length} users in room:`;
    DOM.membersList.innerHTML = '';
    members.forEach(member =>
        DOM.membersList.appendChild(createMemberElement(member))
    );
}

function createMessageElement(text, member) {
    const el = document.createElement('div');
    el.appendChild(createMemberElement(member));
    let myDiv = document.createElement("div");
    myDiv.id = 'myDiv';
    myDiv.innerHTML = '';
    let messages = text.split('\n') || [text];
    for (let i in messages.slice(0, -1)) {
        el.appendChild(document.createTextNode(messages[i]));
        el.appendChild(document.createElement("br"));
        el.appendChild(createMemberElement(''));

    }

    el.appendChild(document.createTextNode(messages.slice(-1)[0]));
    //el.appendChild(myDiv);
    el.className = 'message';
    return el;
}

function addMessageToListDOM(text, member) {
    const el = DOM.messages;
    const wasTop = el.scrollTop === el.scrollHeight - el.clientHeight;
    el.appendChild(createMessageElement(text, member));
    if (wasTop) {
        el.scrollTop = el.scrollHeight - el.clientHeight;
    }
}

if (!checkCookie('username')){
    let username = prompt("Please enter your name:", "");
    if (username !== "" && username != null) {
        setCookie('username', username, 365);
    }
}
if (!checkCookie('sessionID')){
    setCookie('sessionID', uuidv4());
}
let username = getCookie('username');
let sessionID = getCookie('sessionID');

const socket = io();
socket.emit('login', { username: username, session_id: sessionID });


socket.on('message', function(data) {
    addMessageToListDOM(data.body, data.sender);
});

socket.on('room_enter', function(data) {
    members = data.members;
    room.label = data.label;
    room.description = data.description;
    room.directions = data.directions;
    room.location = data.location;
    updateMembersDOM();
    updateRoom();
});
socket.on('room_left', function(data) {
    members.splice(members.indexOf(data.member), 1);
    updateMembersDOM();
});
socket.on('room_join', function(data) {
    members.push(data.member);
    updateMembersDOM();
});

DOM.form.addEventListener('submit', sendMessage);

function sendMessage() {
    const value = DOM.input.value;
    if (value === '') {
        return;
    }
    DOM.input.value = '';
    socket.emit('message', {session_id: sessionID, username: username, message: value});
}