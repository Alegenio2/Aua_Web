document.addEventListener("DOMContentLoaded", function () {
    const events = [
        { date: "2025-06-15T00:00:00", name: "Registro" },
        { date: "2025-07-06T00:00:00", name: "Fin de Registro" },
        { date: "2025-07-14T00:00:00", name: "Inicio Jornada 1" },
        { date: "2025-07-20T00:00:00", name: "Final Jornada 1" },
        { date: "2025-07-21T00:00:00", name: "Inicio Jornada 2" },
        { date: "2025-07-27T00:00:00", name: "Final Jornada 2" },
        { date: "2025-07-28T00:00:00", name: "Inicio Jornada 3" },
        { date: "2025-08-03T00:00:00", name: "Final Jornada 3" },
        { date: "2025-08-04T00:00:00", name: "Inicio Jornada 4" },
        { date: "2025-08-10T00:00:00", name: "Final Jornada 4" },
        { date: "2025-08-11T00:00:00", name: "Inicio Jornada 5" },
        { date: "2025-08-17T00:00:00", name: "Final Jornada 5" },
        { date: "2025-08-18T00:00:00", name: "Inicio Jornada 6" },
        { date: "2025-08-24T00:00:00", name: "Final Jornada 6" },
        { date: "2025-08-25T00:00:00", name: "Inicio Jornada 7" },
        { date: "2025-08-31T00:00:00", name: "Final Jornada 7" },
        { date: "2025-09-01T00:00:00", name: "Inicio Jornada 8" },
        { date: "2025-09-07T00:00:00", name: "Final Jornada 8" },
        { date: "2025-09-14T22:00:00", name: "Final del Torneo" },
    ];

    const now = new Date(new Date().setHours(0, 0, 0, 0));
    const sortedEvents = events.sort((a, b) => new Date(a.date) - new Date(b.date));
    const eventList = document.getElementById("event-list");
    const scrollContainer = document.querySelector(".scroll-container");

    // Limpia la lista antes de añadir nuevos elementos
    eventList.innerHTML = "";

    let todayElement = null;

    // Crea los elementos de la lista
    sortedEvents.forEach(event => {
        const eventDate = new Date(event.date);
        const isToday = now.getTime() === eventDate.getTime();

        const eventItem = document.createElement("li");
        eventItem.classList.add("event");

        const dot = document.createElement("span");
        dot.classList.add(isToday ? "dot-today" : "dot");

        const dateText = document.createElement("span");
        dateText.innerHTML = `<b>${isToday ? "HOY" : `${eventDate.getDate()}/${eventDate.toLocaleString("default", { month: "short" })}`}</b>`;

        const nameText = document.createElement("span");
        nameText.classList.add("name");
        nameText.textContent = event.name;

        eventItem.appendChild(dot);
        eventItem.appendChild(dateText);
        eventItem.appendChild(nameText);

        eventList.appendChild(eventItem);

        if (isToday) {
            todayElement = eventItem;
        }
    });

    // Ajusta el desplazamiento inicial
    if (scrollContainer) {
        if (todayElement) {
            // Centra el evento actual en el contenedor
            const containerWidth = scrollContainer.offsetWidth;
            const elementPosition = todayElement.offsetLeft;
            const elementWidth = todayElement.offsetWidth;

            scrollContainer.scrollLeft = elementPosition - containerWidth / 2 + elementWidth / 2;
        } else {
            // Desplázate al inicio si no hay evento actual
            scrollContainer.scrollLeft = 0;
        }
    }

    // Habilita el desplazamiento suave
    scrollContainer.addEventListener("scroll", () => {
        scrollContainer.style.scrollBehavior = "smooth";
    });
});

