export const environment = {

  production: true,
  // Use Firebase Functions URL for Android/iOS app compatibility
  // Firebase Hosting rewrites /api to the function, but native apps need the full URL
  apiBaseUrl: 'https://us-central1-exam-scanner-b0867.cloudfunctions.net/api'

  ,firebaseConfig: {
    apiKey: 'AIzaSyCsj_mW0dWWk3poOTQCs9ieMhB_5fH2j8M',
    authDomain: 'exam-scanner-b0867.firebaseapp.com',
    projectId: 'exam-scanner-b0867',
    storageBucket: 'exam-scanner-b0867.firebasestorage.app',
    messagingSenderId: '143419617457',
    appId: '1:143419617457:web:8e6d9b9973189d46587290'
  }

};
