document.getElementById("load-time").textContent = new Date().toLocaleTimeString();

document.getElementById("submit-btn").addEventListener("click", () => {
  const name = document.getElementById("name").value || "Guest";
  const action = document.getElementById("action").value;
  let output = "";

  switch (action) {
    case "greet":
      output = `Hello, ${name}! Welcome to the Arc playground.`;
      break;
    case "count":
      // Output the character count of the name
      output = `Name "${name}" has ${name.length} characters.`;
      break;
    case "validate":
      // Validate that the name is at least 2 characters long
      output = name.length < 2
        ? "Name is too short."
        : "Name is valid.";
      break;
  }

  document.getElementById("output").textContent = output;
  document.getElementById("message").textContent = "Form submitted!";
});
