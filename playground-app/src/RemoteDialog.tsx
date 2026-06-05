import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControlLabel,
  Checkbox,
  Box,
  Alert,
  Typography
} from '@mui/material';
import { RemoteOptions, useLiPDStore } from '@linkedearth/lipd-ui';

/**
 * Sanitize dataset name for consistent URI generation (matches lipdjs internal logic)
 */
function sanitizeDatasetName(name: string): string {
  return encodeURIComponent(name.replace(/[^a-zA-Z0-9\-\.]/g, '_'));
}

export interface RemoteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: RemoteOptions, datasetName?: string) => void;
  mode: 'open' | 'save';
  title?: string;
  defaultEndpoint?: string;
  defaultUsername?: string;
  defaultPassword?: string;
}

const RemoteDialog: React.FC<RemoteDialogProps> = ({
  open,
  onClose,
  onConfirm,
  mode,
  title,
  defaultEndpoint = 'https://linkedearth.graphdb.mint.isi.edu/repositories/LiPDVerse-dynamic',
  defaultUsername = '',
  defaultPassword = ''
}) => {
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState(defaultPassword);
  const [datasetName, setDatasetName] = useState('');
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [graphUri, setGraphUri] = useState<string | null>(null);
  const [graphExists, setGraphExists] = useState<'unknown' | 'checking' | 'exists' | 'not_exists' | 'error'>('unknown');

  // Get dataset from store for save mode
  const { dataset } = useLiPDStore((state) => ({ dataset: state.dataset }));

  React.useEffect(() => {
    if (mode === 'save' && dataset) {
      const name = dataset.getName?.() || '';
      if (name) {
        const sanitizedName = sanitizeDatasetName(name);
        setGraphUri(`http://linked.earth/lipd/${sanitizedName}`);
      }
    }
  }, [mode, dataset]);

  React.useEffect(() => {
    if (mode !== 'save' || !graphUri || !endpoint) return;

    const ask = async () => {
      try {
        setGraphExists('checking');
        const askQuery = `ASK WHERE { GRAPH <${graphUri}> { ?s ?p ?o } }`;
        const url = `${endpoint}?query=${encodeURIComponent(askQuery)}&infer=false`;
        const headers: Record<string, string> = { 'Accept': 'application/sparql-results+json' };
        if (username && password) {
          headers['Authorization'] = 'Basic ' + btoa(`${username}:${password}`);
        }
        const res = await fetch(url, { method: 'GET', headers });
        if (!res.ok) throw new Error('status ' + res.status);
        const js = await res.json();
        setGraphExists(js.boolean ? 'exists' : 'not_exists');
      } catch (e) {
        console.warn('Graph check failed', e);
        setGraphExists('error');
      }
    };

    ask();
  }, [mode, graphUri, endpoint, username, password]);

  const handleConfirm = () => {
    const options: RemoteOptions = {
      endpoint,
      username: username || undefined,
      password: password || undefined
    };

    if (rememberCredentials && typeof window !== 'undefined') {
      // Store credentials in localStorage for browser environments
      localStorage.setItem('lipd-graphdb-endpoint', endpoint);
      localStorage.setItem('lipd-graphdb-username', username);
    }

    onConfirm(options, mode === 'open' ? datasetName : undefined);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  // Load saved credentials when dialog opens
  React.useEffect(() => {
    if (open && typeof window !== 'undefined') {
      const savedEndpoint = localStorage.getItem('lipd-graphdb-endpoint');
      const savedUsername = localStorage.getItem('lipd-graphdb-username');
      
      if (savedEndpoint) setEndpoint(savedEndpoint);
      if (savedUsername) setUsername(savedUsername);
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {title || (mode === 'open' ? 'Load from GraphDB' : 'Save to GraphDB')}
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {mode === 'open' && (
            <TextField
              label="Dataset Name"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              fullWidth
              required
              helperText="e.g., Ocn-MadangLagoonPapuaNewGuinea.Kuhnert.2001"
            />
          )}
          
          <TextField
            label="GraphDB Endpoint"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            fullWidth
            required
            helperText="SPARQL endpoint URL"
          />
          
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            helperText="Optional - leave blank for anonymous access"
          />
          
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            helperText="Optional - leave blank for anonymous access"
          />
          
          <FormControlLabel
            control={
              <Checkbox
                checked={rememberCredentials}
                onChange={(e) => setRememberCredentials(e.target.checked)}
              />
            }
            label="Remember endpoint and username"
          />

          {mode === 'save' && graphUri && (
            <Alert severity={graphExists === 'exists' ? 'warning' : graphExists === 'error' ? 'error' : 'info'}>
              <Typography variant="body2">Graph URI: {graphUri}</Typography>
              {graphExists === 'checking' && <Typography variant="caption">Checking if graph exists...</Typography>}
              {graphExists === 'exists' && <Typography variant="caption">A graph with this URI already exists and will be overwritten.</Typography>}
              {graphExists === 'not_exists' && <Typography variant="caption">No existing graph found. A new graph will be created.</Typography>}
              {graphExists === 'error' && <Typography variant="caption">Could not determine if the graph exists (CORS or network error).</Typography>}
            </Alert>
          )}
          
          {/* Original warning replaced by graph status alert above */}
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button 
          onClick={handleConfirm} 
          variant="contained"
          disabled={!endpoint || (mode === 'open' && !datasetName)}
        >
          {mode === 'open' ? 'Load' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RemoteDialog; 