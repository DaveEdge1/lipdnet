import React, { useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import {
  KeyboardArrowDown as ArrowDownIcon,
  Description as FileIcon,
  Cloud as CloudIcon,
  CloudUpload as CloudUploadIcon,
  CloudDownload as CloudDownloadIcon
} from '@mui/icons-material';
import {
  LiPDActions,
  useLiPDStore,
  type RemoteOptions
} from '@linkedearth/lipd-ui';
import RemoteDialog from './RemoteDialog';

const BrowserAppBarActions: React.FC = () => {
  const [openAnchorEl, setOpenAnchorEl] = useState<null | HTMLElement>(null);
  const [saveAnchorEl, setSaveAnchorEl] = useState<null | HTMLElement>(null);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteDialogMode, setRemoteDialogMode] = useState<'open' | 'save'>('open');

  const { dataset, setDataset, setIsLoading, setLoadingMessage, setError, setSuccess } = useLiPDStore(state => ({
    dataset: state.dataset,
    setDataset: state.setDataset,
    setIsLoading: state.setIsLoading,
    setLoadingMessage: state.setLoadingMessage,
    setError: state.setError,
    setSuccess: state.setSuccess
  }));

  // Initialize LiPD actions with progress handlers that update store state
  const lipdActions = new LiPDActions({
    onProgress: (message) => {
      console.log(message);
      setLoadingMessage(message);
    },
    onError: (error: string) => {
      console.error(error);
      setError(error);
      setIsLoading(false);
    },
    onSuccess: (message) => {
      console.log(message);
      setSuccess(message);
    }
  });

  // Handle New
  const handleNew = async () => {
    try {
      setIsLoading(true);
      const newDataset = await lipdActions.createNewLiPD();
      setDataset(newDataset);
      setIsLoading(false);
      setSuccess('New dataset created successfully');
    } catch (error) {
      console.error('Failed to create new dataset:', error);
      setError(`Failed to create new dataset: ${error instanceof Error ? error.message : String(error)}`);
      setIsLoading(false);
    }
  };

  // Handle Open Local
  const handleOpenLocal = () => {
    setOpenAnchorEl(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lpd';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          setIsLoading(true);
          const loadedDataset = await lipdActions.openLocalLiPD(file);
          setDataset(loadedDataset);
          setIsLoading(false);
          setSuccess(`Dataset "${file.name}" loaded successfully`);
        } catch (error) {
          console.error('Failed to open local file:', error);
          setError(`Failed to open local file: ${error instanceof Error ? error.message : String(error)}`);
          setIsLoading(false);
        }
      }
    };
    input.click();
  };

  // Allow the welcome screen (or any other part of the app) to trigger the
  // New / Open actions without prop drilling through LiPDApp.
  React.useEffect(() => {
    const onNew = () => { handleNew(); };
    const onOpen = () => { handleOpenLocal(); };
    window.addEventListener('playground-new', onNew);
    window.addEventListener('playground-open', onOpen);
    return () => {
      window.removeEventListener('playground-new', onNew);
      window.removeEventListener('playground-open', onOpen);
    };
  });

  // Handle Open Remote
  const handleOpenRemote = () => {
    setOpenAnchorEl(null);
    setRemoteDialogMode('open');
    setRemoteDialogOpen(true);
  };

  // Handle Save Local
  const handleSaveLocal = async () => {
    setSaveAnchorEl(null);
    if (!dataset) return;

    try {
      await lipdActions.downloadLiPD(dataset);
      setSuccess('Dataset downloaded successfully');
    } catch (error) {
      console.error('Failed to save local file:', error);
      setError(`Failed to save local file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Handle Save Remote
  const handleSaveRemote = () => {
    setSaveAnchorEl(null);
    setRemoteDialogMode('save');
    setRemoteDialogOpen(true);
  };

  // Handle Remote Dialog Confirm
  const handleRemoteConfirm = async (options: RemoteOptions, datasetName?: string) => {
    try {
      setIsLoading(true);
      if (remoteDialogMode === 'open' && datasetName) {
        const loadedDataset = await lipdActions.openRemoteLiPD(datasetName, options);
        setDataset(loadedDataset);
        setIsLoading(false);
        setSuccess(`Dataset "${datasetName}" loaded from GraphDB successfully`);
      } else if (remoteDialogMode === 'save' && dataset) {
        await lipdActions.saveRemoteLiPD(dataset, options);
        setIsLoading(false);
        setSuccess(`Dataset "${dataset.getName?.() || 'Unknown'}" saved to GraphDB successfully`);
      }
    } catch (error) {
      console.error('Remote operation failed:', error);
      setError(`Remote operation failed: ${error instanceof Error ? error.message : String(error)}`);
      setIsLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {/* New Button */}
      <Button
        variant="outlined"
        size="small"
        onClick={handleNew}
        startIcon={<FileIcon />}
      >
        New
      </Button>

      {/* Open Button with Dropdown */}
      <Button
        variant="outlined"
        size="small"
        onClick={(e) => setOpenAnchorEl(e.currentTarget)}
        endIcon={<ArrowDownIcon />}
        startIcon={<CloudDownloadIcon />}
      >
        Open
      </Button>

      <Menu
        anchorEl={openAnchorEl}
        open={Boolean(openAnchorEl)}
        onClose={() => setOpenAnchorEl(null)}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      >
        <MenuItem onClick={handleOpenLocal}>
          <ListItemIcon>
            <FileIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Local File" secondary="Upload .lpd file" />
        </MenuItem>
        <MenuItem onClick={handleOpenRemote}>
          <ListItemIcon>
            <CloudIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Remote (GraphDB)" secondary="Load from LiPDverse" />
        </MenuItem>
      </Menu>

      {/* Save Button with Dropdown */}
      <Button
        variant="outlined"
        size="small"
        disabled={!dataset}
        onClick={(e) => setSaveAnchorEl(e.currentTarget)}
        endIcon={<ArrowDownIcon />}
        startIcon={<CloudUploadIcon />}
      >
        Save
      </Button>

      <Menu
        anchorEl={saveAnchorEl}
        open={Boolean(saveAnchorEl)}
        onClose={() => setSaveAnchorEl(null)}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      >
        <MenuItem onClick={handleSaveLocal}>
          <ListItemIcon>
            <FileIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Local Download" secondary="Download .lpd file" />
        </MenuItem>
        <MenuItem onClick={handleSaveRemote}>
          <ListItemIcon>
            <CloudIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Remote (GraphDB)" secondary="Upload to LiPDverse" />
        </MenuItem>
      </Menu>

      {/* Remote Dialog */}
      <RemoteDialog
        open={remoteDialogOpen}
        onClose={() => setRemoteDialogOpen(false)}
        onConfirm={handleRemoteConfirm}
        mode={remoteDialogMode}
      />
    </Box>
  );
};

export default BrowserAppBarActions;
