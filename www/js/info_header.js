// Función para censurar nombre de usuario
function censurarUsuario(nombreUsuario) {
  if (!nombreUsuario || nombreUsuario === '-') return '-';
  
  const str = nombreUsuario.toString();
  if (str.length <= 4) return str;
  
  const parteVisible = str.slice(0, -4);
  const asteriscos = '*'.repeat(4);
  return parteVisible + asteriscos;
}

// Función para observar y censurar si el contenido cambia dinámicamente
function observarUsuario() {
  const userNameElement = document.getElementById('userName');
  if (!userNameElement) return;

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        const textoOriginal = userNameElement.textContent;
        const textoCensurado = censurarUsuario(textoOriginal);
        if (textoOriginal !== textoCensurado) {
          userNameElement.textContent = textoCensurado;
        }
      }
    }
  });

  observer.observe(userNameElement, { childList: true });
}

// Cargar información del usuario y restaurante
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await window.apiRequest('/api/usuario-actual');
    if (!response.ok) throw new Error('No autenticado');
    const usuario = await response.json();
    
    document.getElementById('restaurantName').textContent = usuario.restaurante_nombre;
    document.getElementById('userName').textContent = censurarUsuario(usuario.usuario);

    observarUsuario(); // Activar observador para cambios futuros

    const loading = document.getElementById('loading');
    const opciones = document.getElementById('opciones');
    const errorDiv = document.getElementById('error');

    if (loading) loading.style.display = 'none';
    if (opciones) opciones.style.display = 'grid';
    if (errorDiv) errorDiv.style.display = 'none';

  } catch (error) {
    console.error('Error al cargar usuario:', error);
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');

    if (loading) loading.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'block';
  }
});
