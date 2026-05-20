fetch('json/divisiones.json')
    .then(response => response.json())
    .then(data => {
        const divisionList = document.getElementById('division-list');

        data.forEach(division => {
            const divisionItem = document.createElement('li');

            const link = document.createElement('a');
            // Agrega el parámetro de categoría en el enlace usando el ID de la división
            // Convertir 1 → a, 2 → b, etc.
            const letraCategoria = String.fromCharCode(96 + division.id);
            link.href = `${division.link}?categoria=${letraCategoria}`;


            const img = document.createElement('img');
            img.src = division.image;
            img.alt = division.name;
            img.classList.add('division-image'); // Clase para estilos, si es necesario

            link.appendChild(img); // Coloca la imagen dentro del enlace
            divisionItem.appendChild(link); // Coloca el enlace dentro del elemento de lista
            divisionList.appendChild(divisionItem); // Agrega el elemento de lista al contenedor

            // Añadir una clase para animación al cargar
            divisionItem.classList.add('fade-in');
        });
    })
    .catch(error => console.error('Error loading divisions:', error));
