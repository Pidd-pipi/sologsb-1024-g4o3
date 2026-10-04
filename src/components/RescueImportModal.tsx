import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  HStack,
  Heading,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spacer,
  Tag,
  Text,
  Textarea,
  Tooltip,
  VStack
} from '@chakra-ui/react';
import {
  AlertTriangle,
  Ban,
  FileUp,
  Link2Off,
  ListChecks,
  RotateCcw,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { statusLabels } from '../data';
import { formatTime } from '../state/useLightingDesk';
import {
  RESCUE_ITEM_LIMIT,
  SAMPLE_RESCUE_SHEET,
  canConfirmRescue,
  parseRescueSheet,
  type RescuePreview
} from '../rescue';
import type { UserRole, Workspace } from '../types';

interface RescueImportModalProps {
  open: boolean;
  workspace: Workspace;
  role: UserRole;
  onClose: () => void;
  onApply: (preview: RescuePreview) => void;
  onSwitchRole: (role: UserRole) => void;
}

export default function RescueImportModal({
  open,
  workspace,
  role,
  onClose,
  onApply,
  onSwitchRole
}: RescueImportModalProps) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ReturnType<typeof parseRescueSheet> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setFileName('');
      setResult(null);
    }
  }, [open]);

  const planName = useMemo(() => {
    const plan = workspace.plans.find((item) => item.id === workspace.activePlanId) ?? workspace.plans[0];
    return plan?.name ?? '';
  }, [workspace]);

  function compare() {
    setResult(parseRescueSheet(text, workspace));
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setText(typeof reader.result === 'string' ? reader.result : '');
      setFileName(file.name);
      setResult(null);
    };
    reader.onerror = () => {
      setResult({ ok: false, errors: [`无法读取文件 ${file.name}，请更换文件后重试。`] });
    };
    reader.readAsText(file);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) readFile(file);
    event.target.value = '';
  }

  function fillSample() {
    setText(SAMPLE_RESCUE_SHEET);
    setFileName('rescue-sheet.sample.json');
    setResult(null);
  }

  function backToEdit() {
    setResult(null);
  }

  function confirmWrite() {
    if (result?.ok) onApply(result.preview);
  }

  return (
    <Modal isOpen={open} onClose={onClose} size="3xl" scrollBehavior="inside" closeOnEsc>
      <ModalOverlay bg="rgba(3, 7, 14, .72)" />
      <ModalContent bg="stage.900" borderColor="whiteAlpha.100" borderWidth="1px">
        <ModalHeader borderBottomWidth="1px" borderColor="whiteAlpha.100">
          <Flex align="center" gap={2}>
            <FileUp size={19} color="#f6c453" />
            <Heading size="sm">灯光组救援单导入</Heading>
          </Flex>
          <Text color="whiteAlpha.500" fontSize="xs" fontWeight="400" mt={1}>
            对照方案：{planName} · 导入前先对照，舞台监督确认后才写入
          </Text>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody py={4}>
          {!(result?.ok) ? (
            <VStack align="stretch" spacing={3}>
              {result && !result.ok ? (
                <Alert status="error" borderRadius="lg" flexDirection="column" alignItems="start">
                  <HStack alignSelf="stretch">
                    <AlertIcon />
                    <AlertTitle fontSize="sm">救援单格式有问题，已拒绝导入，当前方案未改动</AlertTitle>
                  </HStack>
                  <AlertDescription fontSize="xs" mt={2}>
                    <VStack align="start" spacing={1}>
                      {result.errors.map((message, index) => (
                        <Text key={index}>· {message}</Text>
                      ))}
                    </VStack>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert status="info" borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription fontSize="xs">
                    粘贴或上传救援单 JSON。条目超过 {RESCUE_ITEM_LIMIT} 项、字段缺失或取值越界都会整体拒绝；冻结场次、已确认提示在写入时会被拦截并列出。
                  </AlertDescription>
                </Alert>
              )}

              <Flex align="center" gap={2} wrap="wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={handleFileChange}
                  aria-label="选择救援单 JSON 文件"
                />
                <Button size="sm" variant="outline" leftIcon={<FileUp size={15} />} onClick={() => fileInputRef.current?.click()}>
                  选择 JSON 文件
                </Button>
                <Button size="sm" variant="ghost" onClick={fillSample}>填入示例救援单</Button>
                {fileName ? <Tag size="sm" colorScheme="blue">{fileName}</Tag> : null}
              </Flex>

              <Textarea
                aria-label="救援单 JSON 内容"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setResult(null);
                }}
                placeholder='{"title":"...","items":[{"type":"cue","scene":"序章 · 入梦","cue":"Q3","brightness":80}]}'
                minH="240px"
                fontFamily="mono"
                fontSize="xs"
                bg="blackAlpha.300"
              />
            </VStack>
          ) : (
            <PreviewBody preview={result.preview} role={role} onSwitchRole={onSwitchRole} />
          )}
        </ModalBody>

        <ModalFooter borderTopWidth="1px" borderColor="whiteAlpha.100" gap={2}>
          {result?.ok ? (
            <>
              <Button size="sm" variant="ghost" leftIcon={<RotateCcw size={15} />} onClick={backToEdit}>
                返回修改
              </Button>
              <Spacer />
              <Button size="sm" variant="ghost" onClick={onClose}>取消</Button>
              <ConfirmButton preview={result.preview} role={role} onConfirm={confirmWrite} onSwitchRole={onSwitchRole} />
            </>
          ) : (
            <>
              <Spacer />
              <Button size="sm" variant="ghost" onClick={onClose}>取消</Button>
              <Tooltip label={text.trim() ? '' : '请先粘贴或选择救援单'}>
                <Button size="sm" colorScheme="amber" leftIcon={<ListChecks size={15} />} isDisabled={!text.trim()} onClick={compare}>
                  对照当前方案
                </Button>
              </Tooltip>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ConfirmButton({
  preview,
  role,
  onConfirm,
  onSwitchRole
}: {
  preview: RescuePreview;
  role: UserRole;
  onConfirm: () => void;
  onSwitchRole: (role: UserRole) => void;
}) {
  const nothingApplied = preview.appliedGroups.length === 0;
  if (nothingApplied) {
    return (
      <Tooltip label="所有条目都被冻结场次或已确认提示拦截，没有可写入的改动。">
        <Button size="sm" colorScheme="red" isDisabled leftIcon={<Ban size={15} />}>无可写入改动</Button>
      </Tooltip>
    );
  }
  if (!canConfirmRescue(role)) {
    return (
      <HStack spacing={2}>
        <Tag colorScheme="orange" fontSize="11px">
          {role === 'programmer' ? '编程执行' : '只读角色'}不能写入，需舞台监督确认
        </Tag>
        {role === 'programmer' ? (
          <Button size="sm" variant="outline" leftIcon={<ShieldAlert size={15} />} onClick={() => onSwitchRole('stage-manager')}>
            切换为舞台监督
          </Button>
        ) : null}
      </HStack>
    );
  }
  return (
    <Button size="sm" colorScheme="green" leftIcon={<ShieldCheck size={15} />} onClick={onConfirm}>
      舞台监督确认并写入
    </Button>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Box p={2} borderRadius="lg" bg="blackAlpha.300" minW="92px">
      <Text fontSize="lg" fontWeight="800" color={tone ?? 'whiteAlpha.900'}>{value}</Text>
      <Text color="whiteAlpha.500" fontSize="10px">{label}</Text>
    </Box>
  );
}

function PreviewBody({
  preview,
  role,
  onSwitchRole
}: {
  preview: RescuePreview;
  role: UserRole;
  onSwitchRole: (role: UserRole) => void;
}) {
  const affectedByScene = useMemo(() => {
    const map = new Map<string, typeof preview.affected>();
    for (const cue of preview.affected) {
      const list = map.get(cue.sceneId) ?? [];
      list.push(cue);
      map.set(cue.sceneId, list);
    }
    return [...map.entries()];
  }, [preview]);

  return (
    <VStack align="stretch" spacing={4}>
      <Flex gap={2} wrap="wrap">
        <StatBox label="救援单项数" value={String(preview.itemCount)} />
        <StatBox label="可应用分组" value={String(preview.appliedGroups.length)} tone="green.300" />
        <StatBox label="拦截条目" value={String(preview.blocked.length)} tone={preview.blocked.length ? 'red.300' : undefined} />
        <StatBox label="退回未完成" value={String(preview.affected.length)} tone="amber.300" />
        <StatBox label="失效跟随" value={String(preview.brokenFollows.length)} tone={preview.brokenFollows.length ? 'orange.300' : undefined} />
        <StatBox
          label="全剧时长"
          value={`${formatTime(preview.durationBefore)}→${formatTime(preview.durationAfter)}`}
        />
        <StatBox
          label="冲突数（前→后）"
          value={`${preview.conflictsBefore.length}→${preview.conflictsAfter.length}`}
          tone={preview.newConflicts.length ? 'red.300' : 'green.300'}
        />
      </Flex>

      {!canConfirmRescue(role) ? (
        <Alert status="warning" borderRadius="lg">
          <AlertIcon />
          <AlertDescription fontSize="xs">
            当前为{role === 'programmer' ? '编程执行' : '只读'}角色，可以核对预览；写入必须由舞台监督（或灯光设计）确认。
            {role === 'programmer' ? (
              <Button as="span" size="xs" variant="link" colorScheme="amber" ml={2} onClick={() => onSwitchRole('stage-manager')}>
                切换为舞台监督
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert status="info" borderRadius="lg">
          <AlertIcon />
          <AlertDescription fontSize="xs">
            请逐条核对以下对照结果。写入后立即重算全剧时间与冲突，受影响提示退回「{statusLabels.draft}」，并同步更新离线草稿，可撤销。
          </AlertDescription>
        </Alert>
      )}

      {preview.newConflicts.length ? (
        <Alert status="error" borderRadius="lg" flexDirection="column" alignItems="start">
          <HStack>
            <AlertIcon />
            <AlertTitle fontSize="sm">重算后新增 {preview.newConflicts.length} 个冲突</AlertTitle>
          </HStack>
          <AlertDescription fontSize="xs" mt={1}>
            {preview.newConflicts.map((conflict) => conflict.message).join('；')}
          </AlertDescription>
        </Alert>
      ) : null}

      {preview.brokenFollows.length ? (
        <Box borderRadius="lg" borderWidth="1px" borderColor="orange.700" bg="orange.900" p={3}>
          <HStack mb={2}>
            <Link2Off size={15} color="#f6ad55" />
            <Text fontWeight="700" fontSize="sm">会失效的跟随关系（{preview.brokenFollows.length}）</Text>
          </HStack>
          <VStack align="start" spacing={1}>
            {preview.brokenFollows.map((item) => (
              <Text key={item.cueId} fontSize="xs">
                · 「{item.sceneName}」{item.cue} → {item.target}：{item.reason}
              </Text>
            ))}
          </VStack>
        </Box>
      ) : null}

      <Box>
        <HStack mb={2}>
          <ListChecks size={15} color="#68d391" />
          <Heading size="xs">将写入的改动（{preview.appliedGroups.length} 组）</Heading>
        </HStack>
        <VStack align="stretch" spacing={2}>
          {preview.appliedGroups.map((group) => (
            <Box key={group.entryIndex} p={3} borderRadius="lg" bg="blackAlpha.300" borderWidth="1px" borderColor="whiteAlpha.100">
              <Flex align="center" gap={2} mb={group.cueChanges.length || group.newOrder ? 2 : 0}>
                <Badge colorScheme="green">第 {group.entryIndex} 项</Badge>
                <Text fontSize="sm" fontWeight="650">{group.title}</Text>
                <Spacer />
                <Tag size="sm" variant="subtle">{group.sceneName}</Tag>
              </Flex>
              {group.newOrder ? (
                <Text fontSize="xs" fontFamily="mono" color="amber.300" mt={1}>
                  新顺序：{group.newOrder.join('  →  ')}
                </Text>
              ) : null}
              <VStack align="start" spacing={1} mt={group.newOrder ? 2 : 0}>
                {group.cueChanges.map((change) => (
                  <Box key={change.cueId}>
                    <Text fontSize="xs" color="whiteAlpha.600">{change.number} · {change.label}</Text>
                    <Flex wrap="wrap" gap={1} mt={0.5}>
                      {change.fields.map((field) => (
                        <Tag key={field.field} size="sm" colorScheme="blue" fontFamily="mono" fontSize="10px">
                          {field.label}：{field.from} → {field.to}
                        </Tag>
                      ))}
                    </Flex>
                  </Box>
                ))}
              </VStack>
            </Box>
          ))}
        </VStack>
      </Box>

      {preview.blocked.length ? (
        <Box>
          <HStack mb={2}>
            <Ban size={15} color="#fc8181" />
            <Heading size="xs">被拦截、不会写入（{preview.blocked.length}）</Heading>
          </HStack>
          <VStack align="stretch" spacing={1}>
            {preview.blocked.map((item) => (
              <Flex key={`${item.entryIndex}-${item.target}`} gap={2} fontSize="xs" p={2} borderRadius="lg" bg="red.900" align="start">
                <Badge colorScheme="red" flexShrink={0}>第 {item.entryIndex} 项</Badge>
                <Box>
                  <Text fontWeight="650">{item.target}</Text>
                  <Text color="whiteAlpha.600">{item.reason}</Text>
                </Box>
              </Flex>
            ))}
          </VStack>
        </Box>
      ) : null}

      {preview.notices.length ? (
        <Box>
          <Heading size="xs" mb={2}>提示</Heading>
          <VStack align="stretch" spacing={1}>
            {preview.notices.map((item) => (
              <Text key={item.entryIndex} fontSize="xs" color="whiteAlpha.500">· 第 {item.entryIndex} 项：{item.message}</Text>
            ))}
          </VStack>
        </Box>
      ) : null}

      <Divider />

      <Box>
        <HStack mb={2}>
          <AlertTriangle size={15} color="#f6c453" />
          <Heading size="xs">受影响、将退回「{statusLabels.draft}」的灯光提示（{preview.affected.length}）</Heading>
        </HStack>
        <VStack align="stretch" spacing={2}>
          {affectedByScene.map(([sceneId, cues]) => (
            <Box key={sceneId} p={3} borderRadius="lg" bg="blackAlpha.300">
              <Text fontSize="xs" color="whiteAlpha.500" mb={1}>{cues[0]?.sceneName}</Text>
              <Flex wrap="wrap" gap={1}>
                {cues.map((cue) => (
                  <Tag key={cue.cueId} size="sm" colorScheme="orange" title={cue.reasons.join('、')}>
                    {cue.number}（{cue.reasons.join('、')}）
                  </Tag>
                ))}
              </Flex>
            </Box>
          ))}
        </VStack>
      </Box>

      {preview.resolvedConflictCount > 0 ? (
        <Text fontSize="xs" color="green.300">另有 {preview.resolvedConflictCount} 个原冲突将在重算后消除。</Text>
      ) : null}
    </VStack>
  );
}
