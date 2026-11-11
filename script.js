const filters = document.querySelectorAll('[data-filter]');
const publications = [...document.querySelectorAll('.pub')];
filters.forEach(button => button.addEventListener('click', () => {
  const selected = button.dataset.filter;
  filters.forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  publications.forEach(item => { item.hidden = selected !== 'all' && item.dataset.type !== selected; });
  const count = publications.filter(item => !item.hidden).length;
  document.querySelector('.pub-count').textContent = `${count} selected works`;
}));
