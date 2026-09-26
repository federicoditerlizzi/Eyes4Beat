if(new URLSearchParams(location.search).get('output')==='1'){document.querySelector('.ui')?.remove();await import('./output.js')}
else await import('./main.js');
