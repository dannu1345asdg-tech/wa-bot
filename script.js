const socket = io({ reconnection: true });
const $ = id => document.getElementById(id);

socket.on('qr', (d) => {
  $('qrwait').style.display = 'none';
  $('qr').src = d;
  $('qr').style.display = 'block';
});

socket.on('status', (s) => {
  const st = $('status');
  if (s === 'connected') {
    st.innerText = '🟢 CONNECTED';
    st.classList.add('on');
    $('qrbox').style.display = 'none';
    $('pairbox').style.display = 'none';
    $('info').style.display = 'none';
    $('okbox').style.display = 'block';
  } else {
    st.innerText = '🔴 DISCONNECTED';
    st.classList.remove('on');
  }
});

socket.on('pairing-code', (c) => {
  $('code').innerText = c;
  $('code').style.display = 'block';
  $('info').style.display = 'block';
  $('pairerr').classList.add('hide');
  $('btnpair').disabled = false;
  $('btnpair').innerText = '📱 MINTA KODE LAGI';
});

socket.on('pairing-error', (m) => {
  $('pairerr').innerText = '❌ ' + m;
  $('pairerr').classList.remove('hide');
  $('btnpair').disabled = false;
  $('btnpair').innerText = '📱 MINTA KODE';
});

function mintaQR() {
  $('qrbox').style.display = 'block';
  $('qrwait').style.display = 'block';
  $('qr').style.display = 'none';
  socket.emit('request-qr');
}

function mintaKode() {
  const p = $('phone').value.trim();
  if (!p) return alert('Masukin nomor bot dulu!');
  if (!/^62[0-9]{8,13}$/.test(p)) return alert('Format: 628xxx');
  $('code').style.display = 'none';
  $('info').style.display = 'none';
  $('pairerr').classList.add('hide');
  $('btnpair').disabled = true;
  $('btnpair').innerText = '⏳ Loading...';
  socket.emit('request-pairing', p);
    }
