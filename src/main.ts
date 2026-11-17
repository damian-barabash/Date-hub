import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { i18n } from './lib/i18n.svelte';

document.documentElement.lang = i18n.lang;
const target = document.getElementById('app')!;
target.innerHTML = ''; // убираем статичный прелоадер из index.html
export default mount(App, { target });
