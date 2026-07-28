const { spawn } = require('child_process');
const path = require('path');

const gccBin = 'C:\\Users\\casey\\AppData\\Local\\Microsoft\\WinGet\\Packages\\MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\\llvm-mingw-20260616-ucrt-x86_64\\bin';

const env = {
  ...process.env,
  PATH: `${gccBin};${process.env.PATH}`,
  CC: `${gccBin}\\gcc.exe`,
  CXX: `${gccBin}\\g++.exe`,
  AR: `${gccBin}\\ar.exe`
};

console.log('🚀 Compiling & Starting ChupkarIVY Rust Music Bot...');

const child = spawn('cargo', ['run'], {
  cwd: __dirname,
  env: env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log(`Bot process exited with code ${code}`);
});
