document.addEventListener("DOMContentLoaded", function () { 
    fetch('./feed.json')
        .then(response => response.json())
        .then(data => {
            const noticiasContainer = document.getElementById("feed-news");
            
            noticiasContainer.innerHTML = ""; // Limpio el contenido inicial

            // Tomo solo las primeras 3 noticias (si hay menos, toma lo que haya)
            const ultimasNoticias = data.slice(0, 3);

            ultimasNoticias.forEach(item => {
                const title = item.title;
                const link = item.link;
                const description = item.description;
                const pubDate = new Date(item.pubDate).toLocaleDateString();
                const imageUrl = item.image;

                const noticia = document.createElement("div");
                noticia.classList.add("noticia");

                noticia.innerHTML = `
                    <h3><a href="${link}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
                    <img src="${imageUrl}" alt="${title}">
                    <p>${description}</p>
                    <small>Publicado el: ${pubDate}</small>
                `;

                noticiasContainer.appendChild(noticia);
            });
        })
        .catch(error => {
            console.error("Error al obtener el JSON:", error);
            const noticiasContainer = document.getElementById("feed-news");
            noticiasContainer.innerHTML = "<p>Error al cargar las noticias.</p>";
        });
});

