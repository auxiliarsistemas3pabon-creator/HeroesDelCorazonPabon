export function mediaUrl(filename) {
  // Las imágenes de marca viajan con el frontend: no esperan al backend ni a su
  // servicio de archivos y los PNG grandes se sirven optimizados como WebP.
  return `/branding/${filename.replace(/\.png$/i, '.webp')}`
}
