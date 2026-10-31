import { useEffect, useRef, useState } from 'react';

const galleryCategories = ['Craft', 'Brass', 'Copper', 'Puja Articles', 'Dining & Thali Sets', 'Decorative Handicrafts', 'Textiles', 'Woodwork', 'Ceramics', 'Process', 'Other'];
const types = [['photo', 'Photo'], ['video', 'Video'], ['link', 'External Link']];

export default function GalleryManagement({ images, adminRequest, reload, setMessage }) {
  const [mediaType, setMediaType] = useState('photo');
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Craft');
  const [externalUrl, setExternalUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ title: '', description: '', category: 'Craft', externalUrl: '' });
  const inputRef = useRef(null);
  const thumbnailRef = useRef(null);

  useEffect(() => () => selected.forEach((item) => URL.revokeObjectURL(item.preview)), [selected]);
  const chooseFiles = (event) => {
    selected.forEach((item) => URL.revokeObjectURL(item.preview));
    const files = Array.from(event.target.files || []).slice(0, mediaType === 'photo' ? 8 : 1);
    setSelected(files.map((file) => ({ file, title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), preview: URL.createObjectURL(file) })));
  };
  const upload = async (event) => {
    event.preventDefault();
    if (saving || (mediaType !== 'link' && !selected.length) || (mediaType !== 'photo' && !title.trim()) || (mediaType === 'link' && !externalUrl.trim())) return;
    setSaving(true);
    try {
      const data = new FormData();
      data.append('mediaType', mediaType); data.append('title', title); data.append('description', description); data.append('category', category); data.append('externalUrl', externalUrl);
      if (mediaType === 'photo') { selected.forEach(({ file }) => data.append('images', file)); data.append('titles', JSON.stringify(selected.map((item) => item.title))); }
      if (mediaType === 'video') data.append('media', selected[0].file);
      const thumbnail = thumbnailRef.current?.files?.[0];
      if (thumbnail) data.append('thumbnail', thumbnail);
      const response = await adminRequest('/admin/gallery', { method: 'POST', body: data });
      setMessage({ type: 'success', text: `${response.data.length} ${response.data.length === 1 ? 'item' : 'items'} added as drafts.` });
      selected.forEach((item) => URL.revokeObjectURL(item.preview)); setSelected([]); setTitle(''); setDescription(''); setExternalUrl('');
      if (inputRef.current) inputRef.current.value = ''; if (thumbnailRef.current) thumbnailRef.current.value = '';
      await reload();
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Gallery media could not be uploaded.' }); }
    finally { setSaving(false); }
  };
  const beginEdit = (item) => { setEditingId(item.id); setDraft({ title: item.title, description: item.description || '', category: item.category || 'Craft', externalUrl: item.external_url || '' }); };
  const saveDetails = async (event, id) => {
    event.preventDefault();
    try { await adminRequest(`/admin/gallery/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: draft.title, description: draft.description, category: draft.category, ...(draft.externalUrl ? { externalUrl: draft.externalUrl } : {}) }) }); setEditingId(''); setMessage({ type: 'success', text: 'Gallery item details updated.' }); await reload(); }
    catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  const setPublished = async (item, published) => { try { await adminRequest(`/admin/gallery/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) }); await reload(); } catch (error) { setMessage({ type: 'error', text: error.message }); } };
  const remove = async (item) => { if (!window.confirm(`Permanently delete “${item.title}” from the gallery?`)) return; try { await adminRequest(`/admin/gallery/${item.id}`, { method: 'DELETE' }); setMessage({ type: 'success', text: 'Gallery item deleted.' }); await reload(); } catch (error) { setMessage({ type: 'error', text: error.message }); } };
  const move = async (index, offset) => { const target = index + offset; if (target < 0 || target >= images.length) return; const reordered = [...images]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]]; try { for (let orderIndex = 0; orderIndex < reordered.length; orderIndex += 1) await adminRequest(`/admin/gallery/${reordered[orderIndex].id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIndex }) }); await reload(); } catch (error) { setMessage({ type: 'error', text: error.message }); } };
  const isPhoto = mediaType === 'photo';
  const isLink = mediaType === 'link';
  const accept = isPhoto ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/webm';

  return <section className="gallery-admin" aria-labelledby="gallery-admin-title">
    <div className="admin-section-heading"><div><p className="eyebrow">MEDIA LIBRARY</p><h2 id="gallery-admin-title">Gallery Management</h2><p>Add photos, video clips and links to the public gallery.</p></div><span className="admin-muted">{images.length} items</span></div>
    <form className="gallery-upload-form" onSubmit={upload}>
      <div className="gallery-upload-heading"><div><span className="eyebrow">ADD TO THE COLLECTION</span><h3>Add gallery media.</h3></div></div>
      <fieldset className="gallery-type-selector"><legend>Content type</legend>{types.map(([value, label]) => <label key={value} className={mediaType === value ? 'selected' : ''}><input type="radio" name="gallery-type" value={value} checked={mediaType === value} onChange={() => { setMediaType(value); setSelected([]); if (inputRef.current) inputRef.current.value = ''; }} /><span>{label}</span></label>)}</fieldset>
      {mediaType !== 'photo' && <label className="gallery-upload-single-field">Title<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={isLink ? 'Link title' : 'Video title'} /></label>}
      {!isLink && <label className="gallery-file-picker">Choose {isPhoto ? 'photos' : 'video'}<input ref={inputRef} type="file" accept={accept} multiple={isPhoto} onChange={chooseFiles} /><span>{isPhoto ? 'JPG, JPEG, PNG or WEBP · up to 5 MB each · 8 at a time' : 'MP4 or WebM · up to 100 MB'}</span></label>}
      {isLink && <label className="gallery-upload-single-field">HTTPS URL<input required type="url" inputMode="url" pattern="https://.+" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://…" /></label>}
      {selected.length > 0 && <div className="gallery-preview-grid">{selected.map((item, index) => <article className="gallery-preview-card" key={`${item.file.name}-${item.file.lastModified}`}>{isPhoto ? <img src={item.preview} alt={`Preview of ${item.file.name}`} /> : <video src={item.preview} controls preload="metadata" aria-label="Video preview" />}<label>{isPhoto ? 'Title' : 'Preview'}{isPhoto && <input required maxLength={160} value={item.title} onChange={(event) => setSelected((items) => items.map((current, i) => i === index ? { ...current, title: event.target.value } : current))} />}</label><small>{item.file.name} · {(item.file.size / (1024 * 1024)).toFixed(1)} MB · {item.file.type.split('/')[1]?.toUpperCase()}</small></article>)}</div>}
      {(isLink || mediaType === 'video') && <label className="gallery-file-picker">Optional thumbnail<input ref={thumbnailRef} type="file" accept="image/jpeg,image/png,image/webp" /><span>JPG, PNG or WebP · up to 5 MB</span></label>}
      <div className="gallery-upload-fields"><label>Description <span>Optional</span><textarea rows="3" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the craft, material, or moment." /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{galleryCategories.map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <div className="gallery-upload-actions"><span>New uploads start as unpublished drafts.</span><button className="button primary" type="submit" disabled={saving || (!isLink && !selected.length)}>{saving ? 'Saving…' : isLink ? 'Add link' : `Upload ${selected.length || ''} ${isPhoto ? 'photo' : 'video'}${isPhoto && selected.length !== 1 ? 's' : ''}`}</button></div>
    </form>
    <div className="gallery-admin-list-heading"><div><p className="eyebrow">ALL MEDIA</p><h3>Manage the gallery.</h3></div></div>
    {images.length ? <div className="gallery-admin-list">{images.map((item, index) => { const type = item.media_type || 'photo'; const thumb = item.thumbnail_url || item.image_url || item.media_url; return <article className="gallery-admin-card" key={item.id}>
      <div className="gallery-admin-preview">{thumb ? <img className="gallery-admin-thumb" src={thumb} alt={item.title} /> : <span className="gallery-admin-no-thumb">{type === 'link' ? '↗' : '▶'}</span>}<span>{type}</span></div>
      <div className="gallery-admin-info"><span className="gallery-admin-category">{item.category} · {item.published ? 'Published' : 'Draft'}</span><strong>{item.title}</strong><p>{item.description || item.external_url || 'No description added.'}</p></div>
      <div className="gallery-admin-actions"><button type="button" className="gallery-order-button" aria-label={`Move ${item.title} up`} disabled={!index} onClick={() => move(index, -1)}>↑</button><button type="button" className="gallery-order-button" aria-label={`Move ${item.title} down`} disabled={index === images.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" onClick={() => editingId === item.id ? setEditingId('') : beginEdit(item)}>{editingId === item.id ? 'Cancel' : 'Edit'}</button><button type="button" onClick={() => setPublished(item, !item.published)}>{item.published ? 'Unpublish' : 'Publish'}</button><button type="button" className="danger-action" onClick={() => remove(item)}>Delete</button></div>
      {editingId === item.id && <form className="gallery-edit-form" onSubmit={(event) => saveDetails(event, item.id)}><label>Title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Description<textarea rows="3" maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{galleryCategories.map((value) => <option key={value}>{value}</option>)}</select></label>{type === 'link' && <label>HTTPS URL<input required type="url" pattern="https://.+" value={draft.externalUrl} onChange={(event) => setDraft({ ...draft, externalUrl: event.target.value })} /></label>}<button className="button primary" type="submit">Save details</button></form>}
    </article>; })}</div> : <div className="admin-empty gallery-admin-empty">No gallery media yet. Add photos, video or a link above.</div>}
  </section>;
}
