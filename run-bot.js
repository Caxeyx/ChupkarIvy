const { spawn } = require('child_process');

const gccBin = 'C:\\Users\\casey\\AppData\\Local\\Microsoft\\WinGet\\Packages\\MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\\llvm-mingw-20260616-ucrt-x86_64\\bin';
const cmakeBin = 'C:\\Program Files\\CMake\\bin';

const env = {
  ...process.env,
  PATH: `${gccBin};${cmakeBin};${process.env.PATH}`,
  CC: `${gccBin}\\gcc.exe`,
  CXX: `${gccBin}\\g++.exe`,
  AR: `${gccBin}\\ar.exe`
};

console.log('🚀 Checking Rust Spotify Connect librespot engine...');

const child = spawn('cargo', ['check'], {
  cwd: __dirname,
  env: env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log(`Cargo check exited with code ${code}`);
});
