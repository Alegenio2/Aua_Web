// Inicializar SwiperJS
const swiper = new Swiper('.swiper', {
    loop: true,
    autoplay: { delay: 5000 },
    pagination: { el: '.swiper-pagination', clickable: true },
  });

const swiperlateral = new Swiper('.swiperlateral', {
    loop: true,
    autoplay: { delay: 5000 },
    pagination: { el: '.swiper-pagination', clickable: true },
  });
  
 
  // Toggle menú hamburguesa
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('main-nav');
  
  hamburger.addEventListener('click', () => {
    nav.classList.toggle('active');
  });
