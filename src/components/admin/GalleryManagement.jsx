import { useEffect, useRef, useState } from 'react';

const galleryCategories = ['Craft', 'Brass', 'Copper', 'Puja Articles', 'Dining & Thali Sets', 'Decorative Handicrafts', 'Textiles', 'Woodwork', 'Ceramics', 'Process', 'Other'];

export default function GalleryManagement({ images, adminRequest, reload, setMessage }) {
  const [selected, setSelected] = useState([]);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Craft');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ title: '', description: '', category: 'Craft' });
  const inputRef = useRef(null);

  useEffect(() => () => selected.forEach((item) => URL.revokeObjectURL(item.preview)), [selected]);
  const chooseImages = (event) => {
    selected.forEach((item) => URL.revokeObjectURL(item.preview));
    const files = Array.from(event.target.files || []).slice(0, 8);
    setSelected(files.map((file) => ({ file, title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), preview: URL.createObjectURL(file) })));
  };
  const updateTitle = (index, title) => setSelected((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item));
  const upload = async (event) => {
    event.preventDefault();
    if (!selected.length || saving) return;
    setSaving(true);
    try {
      const data = new FormData();
      selected.forEach(({ file }) => data.append('images', file));
      data.append('titles', JSON.stringify(selected.map((item) => item.title)));
      data.append('description', description);
      data.append('category', category);
      const response = await adminRequest('/admin/gallery', { method: 'POST', body: data });
      setMessage({ type: 'success', text: `${response.data.length} ${response.data.length === 1 ? 'image' : 'images'} uploaded as drafts.` });
      selected.forEach((item) => URL.revokeObjectURL(item.preview));
      setSelected([]); setDescription(''); setCategory('Craft');
      if (inputRef.current) inputRef.current.value = '';
      await reload();
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Gallery images could not be uploaded.' }); }
    finally { setSaving(false); }
  };
  const beginEdit = (image) => { setEditingId(image.id); setDraft({ title: image.title, description: image.description || '', category: image.category || 'Craft' }); };
  const saveDetails = async (event, id) => {
    event.preventDefault();
    try {
      await adminRequest(`/admin/gallery/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      setEditingId(''); setMessage({ type: 'success', text: 'Gallery image details updated.' }); await reload();
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  const setPublished = async (image, published) => {
    try { await adminRequest(`/admin/gallery/${image.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) }); await reload(); }
    catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  const remove = async (image) => {
    if (!window.confirm(`Permanently delete “${image.title}” from the gallery?`)) return;
    try { await adminRequest(`/admin/gallery/${image.id}`, { method: 'DELETE' }); setMessage({ type: 'success', text: 'Gallery image deleted.' }); await reload(); }
    catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  const move = async (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= images.length) return;
    const reordered = [...images];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      for (let orderIndex = 0; orderIndex < reordered.length; orderIndex += 1) {
        await adminRequest(`/admin/gallery/${reordered[orderIndex].id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIndex }) });
      }
      await reload();
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
  };

  return <section className="gallery-admin" aria-labelledby="gallery-admin-title">
    <div className="admin-section-heading"><div><p className="eyebrow">IMAGE LIBRARY</p><h2 id="gallery-admin-title">Gallery Management</h2><p>Upload collection photographs, prepare their details, then publish them to the public gallery.</p></div><span className="admin-muted">{images.length} images</span></div>
    <form className="gallery-upload-form" onSubmit={upload}>
      <div className="gallery-upload-heading"><div><span className="eyebrow">ADD TO THE COLLECTION</span><h3>Upload images.</h3></div><span>JPEG, PNG or WebP · up to 5 MB each · 8 at a time</span></div>
      <label className="gallery-file-picker">Choose images<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} /><span>Select up to 8 images from your device</span></label>
      {selected.length > 0 && <div className="gallery-preview-grid">{selected.map((item, index) => <article className="gallery-preview-card" key={`${item.file.name}-${item.file.lastModified}`}><img src={item.preview} alt={`Preview of ${item.file.name}`} /><label>Title<input required maxLength={160} value={item.title} onChange={(event) => updateTitle(index, event.target.value)} /></label></article>)}</div>}
      <div className="gallery-upload-fields"><label>Description <span>Optional; applies to all selected images</span><textarea rows="3" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the craft, material, or moment." /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{galleryCategories.map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <div className="gallery-upload-actions"><span>New uploads start as unpublished drafts.</span><button className="button primary" type="submit" disabled={!selected.length || saving}>{saving ? 'Uploading…' : `Upload ${selected.length || ''} ${selected.length === 1 ? 'image' : 'images'}`}</button></div>
    </form>
    <div className="gallery-admin-list-heading"><div><p className="eyebrow">ALL IMAGES</p><h3>Manage the gallery.</h3></div></div>
    {images.length ? <div className="gallery-admin-list">{images.map((image, index) => <article className="gallery-admin-card" key={image.id}>
      <img className="gallery-admin-thumb" src={image.image_url} alt={image.title} />
      <div className="gallery-admin-info"><span className="gallery-admin-category">{image.category} · {image.published ? 'Published' : 'Draft'}</span><strong>{image.title}</strong><p>{image.description || 'No description added.'}</p></div>
      <div className="gallery-admin-actions"><button type="button" className="gallery-order-button" aria-label={`Move ${image.title} up`} title="Move up" disabled={!index} onClick={() => move(index, -1)}>↑</button><button type="button" className="gallery-order-button" aria-label={`Move ${image.title} down`} title="Move down" disabled={index === images.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" onClick={() => editingId === image.id ? setEditingId('') : beginEdit(image)}>{editingId === image.id ? 'Cancel' : 'Edit'}</button><button type="button" onClick={() => setPublished(image, !image.published)}>{image.published ? 'Unpublish' : 'Publish'}</button><button type="button" className="danger-action" onClick={() => remove(image)}>Delete</button></div>
      {editingId === image.id && <form className="gallery-edit-form" onSubmit={(event) => saveDetails(event, image.id)}><label>Title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Description<textarea rows="3" maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{galleryCategories.map((value) => <option key={value}>{value}</option>)}</select></label><button className="button primary" type="submit">Save details</button></form>}
    </article>)}</div> : <div className="admin-empty gallery-admin-empty">No gallery images yet. Choose a few photographs above to begin.</div>}
  </section>;
}
