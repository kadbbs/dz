window.DZ_CONFIG = {
  // "auto" means:
  // - local HTTP development: ws://<current-host>:3001
  // - HTTPS deployment: wss://<current-host>/mediasoup
  // Set a full URL here when using a separate media domain, e.g. wss://media.example.com.
  mediasoupUrl: 'auto',
  mediasoupPath: '/mediasoup',
  mediasoupDevPort: 3001,
};
