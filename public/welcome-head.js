// The two head lines starter.html writes inline (the hero's entrance guard and the moments guard),
// as a file: the app's CSP allows no inline script without a nonce. Loaded plain (not deferred).
document.documentElement.classList.add('m-enter');
setTimeout(() => document.documentElement.classList.add('m-enter-done'), 700);
document.documentElement.classList.add('mo-js');
setTimeout(() => document.documentElement.classList.add('mo-safe'), 2500);
