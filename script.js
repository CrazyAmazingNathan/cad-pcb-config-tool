// --- Globals ---
let port = null;
let reader = null;
let writer = null;
let readLoopRunning = false;
let serialBuffer = "";

const enc = new TextEncoder();
const dec = new TextDecoder();

const el = (id) => document.getElementById(id);

function log(msg) {
  const logEl = el("log");
  const now = new Date().toISOString().split("T")[1].replace("Z", "");
  logEl.textContent += "[" + now + "] " + msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function setConnectedUI(connected) {
  el("connStatus").textContent = connected ? "Connected" : "Disconnected";
  el("connStatus").classList.toggle("connected", connected);
  el("connStatus").classList.toggle("disconnected", !connected);

  el("btnConnect").disabled = connected;
  el("btnDisconnect").disabled = !connected;
  el("btnGetNet").disabled = !connected;
  el("btnSaveNet").disabled = !connected;
  el("btnReboot").disabled = !connected;
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("Your browser does not support Web Serial.\nUse Chrome or Edge on desktop.");
    return;
  }
  try {
    // You can add filters here for specific USB VID/PIDs if you want.
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200, dataBits: 8, parity: "none", stopBits: 1 });

    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    readLoopRunning = true;
    setConnectedUI(true);
    log("Serial port opened.");

    readLoop(); // fire and forget
  } catch (err) {
    console.error(err);
    log("Error opening serial port: " + err);
    await disconnectSerial(true);
  }
}

async function disconnectSerial(silent) {
  readLoopRunning = false;
  try {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      reader = null;
    }
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
    if (port) {
      await port.close().catch(() => {});
      port = null;
    }
  } catch (err) {
    if (!silent) log("Error closing port: " + err);
  }
  setConnectedUI(false);
  if (!silent) log("Serial port closed.");
}

async function readLoop() {
  serialBuffer = "";
  while (readLoopRunning && port && reader) {
    try {
      const { value, done } = await reader.read();
      if (done) {
        log("Serial read done.");
        break;
      }
      if (value) {
        const text = dec.decode(value);
        serialBuffer += text;
        let idx;
        while ((idx = serialBuffer.indexOf("\n")) >= 0) {
          const line = serialBuffer.slice(0, idx);
          serialBuffer = serialBuffer.slice(idx + 1);
          handleSerialLine(line.trim());
        }
      }
    } catch (err) {
      log("Serial read error: " + err);
      break;
    }
  }
  await disconnectSerial(true);
}

function handleSerialLine(line) {
  if (!line) return;
  // Many Arduino messages are not JSON; state replies are.
  if (line[0] === "{") {
    try {
      const obj = JSON.parse(line);
      log("JSON <= " + line);
      handleStateJson(obj);
    } catch (err) {
      log("JSON parse error: " + err + " (line: " + line + ")");
    }
  } else {
    log("<- " + line);
  }
}

function handleStateJson(j) {
  // This is the same shape as your stateJson() output.
  const stateLines = [];
  if (j.modeText) {
    stateLines.push("Mode: " + j.modeText);
  }
  if (j.sSub !== undefined && j.sUni !== undefined && j.sChan !== undefined) {
    stateLines.push(
      "Art-Net: Subnet " + j.sSub + ", Universe " + j.sUni + ", Channel " + j.sChan
    );
  }
  if (j.ssid !== undefined) {
    stateLines.push("Wi-Fi: " + j.ssid);
  }
  if (j.ip !== undefined && j.gw !== undefined && j.sn !== undefined) {
    stateLines.push("IP: " + j.ip + "  GW: " + j.gw + "  SN: " + j.sn);
  }
  el("stateSummary").textContent = stateLines.join(" | ");

  // Populate network form fields with current values.
  if (j.ssid !== undefined) el("ssid").value = j.ssid;
  if (j.ip !== undefined) el("ip").value = j.ip;
  if (j.gw !== undefined) el("gw").value = j.gw;
  if (j.sn !== undefined) el("sn").value = j.sn;
  // never populate password for security; user can re-enter if needed
}

async function sendJson(obj) {
  if (!port || !writer) {
    alert("Not connected to a board yet.");
    return;
  }
  const txt = JSON.stringify(obj);
  log("=> " + txt);
  const bytes = enc.encode(txt + "\n");
  await writer.write(bytes);
}

// --- Button handlers ---

el("btnConnect").addEventListener("click", () => connectSerial());
el("btnDisconnect").addEventListener("click", () => disconnectSerial(false));

el("btnGetNet").addEventListener("click", async () => {
  await sendJson({ cmd: "GET_NET" });
});

el("btnReboot").addEventListener("click", async () => {
  if (!confirm("Send REBOOT command to board?")) return;
  await sendJson({ cmd: "REBOOT" });
});

el("btnSaveNet").addEventListener("click", async () => {
  const ssid = el("ssid").value.trim();
  const pwd = el("pwd").value; // may be blank intentionally
  const ip = el("ip").value.trim();
  const gw = el("gw").value.trim();
  const sn = el("sn").value.trim();

  const payload = { cmd: "SET_NET" };

  if (ssid.length > 0) payload.ssid = ssid;
  if (pwd.length > 0) payload.pwd = pwd;
  if (ip.length > 0) payload.ip = ip;
  if (gw.length > 0) payload.gw = gw;
  if (sn.length > 0) payload.sn = sn;

  if (Object.keys(payload).length === 1) {
    alert("No changes to send. Edit at least one field.");
    return;
  }

  if (!confirm("Send new network settings to board? It may change its IP.")) return;

  await sendJson(payload);

  // Board will attempt Wi-Fi reconnect and then send back updated state JSON.
  // We just wait for that to arrive and show up in the log/summary.
});

el("btnOpenFlasher").addEventListener("click", () => {
  // Official esptool-js demo from Espressif – runs entirely in browser.
  window.open("https://espressif.github.io/esptool-js/", "_blank");
});
