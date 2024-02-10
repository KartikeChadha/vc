const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const screenStream = document.getElementById("screenStream");
const callButton = document.getElementById("callButton");
const hangupButton = document.getElementById("hangupButton");
const screenShareButton = document.getElementById("screenShareButton");
const stopScreenShareButton = document.getElementById("stopScreenShareButton");
const socket = new WebSocket("wss://localhost:8888", "echo-protocol");

let peerConnection;
let dataChannel;
let emojiChannel;
let localMediaStream;
let remoteId;

let flag = false;
const remoteMediaStream = new MediaStream(); // stream from the remote peer

//monaco editor
require(["vs/editor/editor.main"], function () {
  const editor = monaco.editor.create(
    document.getElementById("editor-container"),
    {
      value: 'console.log("Hello, Monaco Editor!");',
      language: "javascript",
      theme: "vs-dark", // Set the theme to VS Code Dark
    }
  );

  // Expose the Monaco Editor instance to the global scope
  window.monacoEditor = editor;
  const monacoEditor = window.monacoEditor;

  if (window.monacoEditor) {
    // const monacoEditor = window.monacoEditor;

    monacoEditor.getModel().onDidChangeContent(() => {
      const content = monacoEditor.getValue();
      if (!flag) {
        sendEditorData(content);
      }
      // console.log(content);
    });
  }

  // Now, you can access 'window.monacoEditor' from other scripts
});
//monaco editor -end

socket.onopen = () => {
  console.log("socket::open");
};

socket.onmessage = async ({ data }) => {
  try {
    const jsonMessage = JSON.parse(data);

    console.log("action", jsonMessage.action);
    switch (jsonMessage.action) {
      case "start":
        console.log("start", jsonMessage.id);
        callButton.disabled = false;
        document.getElementById("localId").innerHTML = jsonMessage.id;
        break;
      case "offer":
        remoteId = jsonMessage.data.remoteId;
        delete jsonMessage.data.remoteId;

        await initializePeerConnection(localMediaStream.getTracks());
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(jsonMessage.data.offer)
        );

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendSocketMessage("answer", { remoteId, answer });
        break;
      case "answer":
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(jsonMessage.data.answer)
        );
        break;
      case "iceCandidate":
        await peerConnection.addIceCandidate(jsonMessage.data.candidate);
        break;
      default:
        console.warn("unknown action", jsonMessage.action);
    }
  } catch (error) {
    console.error("failed to handle socket message", error);
  }
};

socket.onerror = (error) => {
  console.error("socket::error", error);
};

socket.onclose = () => {
  console.log("socket::close");
  stop();
};

const sendSocketMessage = (action, data) => {
  const message = { action, data };
  socket.send(JSON.stringify(message));
};

const start = async () => {
  try {
    localMediaStream = await getLocalMediaStream();

    sendSocketMessage("start");
  } catch (error) {
    console.error("failed to start stream", error);
  }
};

const call = async () => {
  try {
    remoteId = document.getElementById("callId").value;

    if (!remoteId) {
      alert("Please enter a remote id");

      return;
    }

    console.log("call: ", remoteId);
    await initializePeerConnection(localMediaStream.getTracks());
    initializeDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSocketMessage("offer", { offer, remoteId });
  } catch (error) {
    console.error("failed to initialize call", error);
  }
};

const hangup = () => socket.close();

const stop = () => {
  if (!localVideo.srcObject) return;

  for (const track of localVideo.srcObject.getTracks()) {
    console.log("stop track", track);
    track.stop();
  }

  for (const sender of peerConnection.getSenders()) {
    sender.track.stop();
  }

  dataChannel.close();
  peerConnection.close();
  callButton.disabled = true;
  hangupButton.disabled = true;
  screenShareButton.disabled = true;
  localVideo.srcObject = undefined;
  remoteVideo.srcObject = undefined;
  screenStream.srcObject = undefined;
  stopScreenShareButton.disabled = true;
};

const getLocalMediaStream = async () => {
  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    console.log("got local media stream");

    localVideo.srcObject = mediaStream;

    return mediaStream;
  } catch (error) {
    console.error("failed to get local media stream", error);
  }
};

const initializePeerConnection = async (mediaTracks) => {
  const config = { iceServers: [{ urls: ["stun:stun1.l.google.com:19302"] }] };
  peerConnection = new RTCPeerConnection(config);

  peerConnection.onicecandidate = ({ candidate }) => {
    if (!candidate) return;

    console.log("peerConnection::icecandidate", candidate);
    console.log("remote", remoteId);
    sendSocketMessage("iceCandidate", { remoteId, candidate });
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      "peerConnection::iceconnectionstatechange newState=",
      peerConnection.iceConnectionState
    );
    // If ICE state is disconnected stop
    if (peerConnection.iceConnectionState === "disconnected") {
      alert("Connection has been closed stopping...");
      socket.close();
    }
  };

  peerConnection.ontrack = ({ track }) => {
    console.log("peerConnection::track", track);
    remoteMediaStream.addTrack(track);
    remoteVideo.srcObject = remoteMediaStream;
  };

  peerConnection.ondatachannel = ({ channel }) => {
    console.log("peerConnection::ondatachannel");

    newChannel = channel;
    const label = newChannel.label;
    console.log("CURRENT LABEL:", label);
    if (label === "dataChannel") {
      dataChannel = newChannel;
    } else if (label === "emojiChannel") {
      emojiChannel = newChannel;
    }

    initializeDataChannelListeners();
    initializeEmojiChannelListeners();
  };

  //remote connection for emojichannel
  // peerConnection.ondatachannel = ({ channel }) => {
  //   console.log("peerConnection::onEmojichannel");
  //   emojiChannel = channel;

  //   initializeDataChannelListeners();
  // };

  for (const track of mediaTracks) {
    peerConnection.addTrack(track);
  }

  hangupButton.disabled = false;
  screenShareButton.disabled = false;
};

const initializeDataChannel = () => {
  const config = { ordered: true };

  dataChannel = peerConnection.createDataChannel("dataChannel", config);
  emojiChannel = peerConnection.createDataChannel("emojiChannel", config);
  initializeDataChannelListeners();
  initializeEmojiChannelListeners();
};

const initializeDataChannelListeners = () => {
  dataChannel.onopen = () => console.log("dataChannel opened");
  dataChannel.onclose = () => console.log("dataChannel closed");
  dataChannel.onerror = (error) => console.error("dataChannel error:", error);

  dataChannel.onmessage = ({ data }) => {
    console.log("dataChannel data", data);
  };
};

const updateMonacoEditor = (data) => {
  console.log("hehe");
  flag = true;
  window.monacoEditor.setValue(data);

  flag = false;
};

//new emojiDataChannel
const initializeEmojiChannelListeners = () => {
  emojiChannel.onopen = () => console.log("emojiChannel opened");
  emojiChannel.onclose = () => console.log("emojiChannel closed");
  emojiChannel.onerror = (error) => console.error("emojiChannel error:", error);

  emojiChannel.onmessage = ({ data }) => {
    updateMonacoEditor(data);
    // console.log("emojiChannel data", data);
  };
};

const shareScreen = async () => {
  const mediaStream = await getLocalScreenCaptureStream();

  const screenTrack = mediaStream.getVideoTracks()[0];
  //having stream separate to the video calls
  if (screenTrack) {
    console.log("replace camera track with screen track");
    replaceTrack(screenTrack);
    // addTrack(screenTrack);

    // screenStream.srcObject = screenTrack;
  }
};
const stopShareScreen = async () => {
  // const mediaStream = await getLocalScreenCaptureStream();

  // const screenTrack = mediaStream.getVideoTracks()[0];
  //having stream separate to the video calls
  stopScreenShareButton.disabled = true;
  localMediaStream = await getLocalMediaStream();
  localTrack = localMediaStream.getVideoTracks()[0];
  if (localTrack) {
    console.log("replace camera track with screen track");
    replaceTrack(localTrack);
    // addTrack(screenTrack);

    // screenStream.srcObject = screenTrack;
  }
};

const getLocalScreenCaptureStream = async () => {
  try {
    const constraints = { video: { cursor: "always" }, audio: false };
    const screenCaptureStream = await navigator.mediaDevices.getDisplayMedia(
      constraints
    );

    return screenCaptureStream;
  } catch (error) {
    console.error("failed to get local screen", error);
  }
};

const replaceTrack = (newTrack) => {
  const sender = peerConnection
    .getSenders()
    .find((sender) => sender.track.kind === newTrack.kind);
  // console.log(peerConnection.getSenders());
  console.log(sender.track.kind, newTrack.kind);

  if (!sender) {
    console.warn("failed to find sender");

    return;
  }
  console.log("replaced");
  stopScreenShareButton.disabled = false;
  sender.replaceTrack(newTrack);
};

//add track to remote screenshare
const addTrack = (newTrack) => {
  // Check if the new track is already in the connection
  const existingTrack = peerConnection
    .getSenders()
    .find((sender) => sender.track === newTrack);

  // If the track is not already in the connection, add it
  if (!existingTrack) {
    peerConnection.addTrack(newTrack);
  } else {
    console.warn("Track is already in the connection");
  }
  sender.addTrack(newTrack);
};

const sendMessage = () => {
  const message = document.getElementById("chatMessage").value;

  if (!message) {
    alert("no message entered");

    return;
  }

  if (!dataChannel || dataChannel.readyState !== "open") {
    alert("data channel is undefined or is not connected");

    return;
  }

  console.log("sending message", message);
  const data = {
    message,
    time: new Date(),
  };

  dataChannel.send(JSON.stringify(data));
  document.getElementById("chatMessage").value = "";
};

//Adding a new dataChannel
// const sendEmoji = () => {
//   const message = document.getElementById("emojiMessage").value;

//   if (!message) {
//     alert("no message entered");

//     return;
//   }

//   if (!emojiChannel || emojiChannel.readyState !== "open") {
//     alert("data channel is undefined or is not connected");

//     return;
//   }

//   console.log("sending emoji", message);
//   const data = {
//     message,
//     time: new Date(),
//   };

//   emojiChannel.send(JSON.stringify(data));
//   document.getElementById("emojiMessage").value = "";
// };

const sendEditorData = (data) => {
  // const data = window.monacoEditor.getValue();
  emojiChannel.send(data);
};

// emojiChannel.onmessage = (event) => {
//   const recievedData = JSON.parse(event.data);
//   console.log("hi hello");

//   updateMonacoEditor(recievedData);
// };
