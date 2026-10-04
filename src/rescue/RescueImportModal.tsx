import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Box,
  Button,
  Checkbox,
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
  Stack,
  Tag,
  Text,
  Textarea,
  useToast
} from '@chakra-ui/react';
import {
  AlertTriangle,
  FileWarning,
  Link2Off,
  ListChecks,
  Lock,
  RefreshCcw,
  Siren,
  Upload
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  parseRescueSheetText,
  simulateRescueSheet,
  type RescuePreview
} from './rescueSheet';
import { roleLabels } from '../data';
import { formatTime } from '../state/useLightingDesk';
import type { LightingPlan, UserRole } from '../types';

const SAMPLE_RESCUE_SHEET = `{
  "title": "演出前夜救援单（示例）",
  "channelReplacements": [
    { "from": "Grand Master", "to": "Grand Master A" }
  ],
  "items": [
    { "sceneOrder": 1, "cueNumber": "Q2", "order": 1, "brightness": 70, "fadeIn": 6 },
    { "sceneOrder": 1, "cueNumber": "Q3", "brightness": 80, "followCueNumber": null },
    { "sceneOrder": 2, "cueNumber": "Q10", "hold": 26 },
    { "sceneOrder": 3, "cueNumber": "Q22", "brightness": 100, "fadeOut": 4 },
    { "sceneOrder": 4, "cueNumber": "Q30", "brightness": 60 }
  ]
}`;

interface RescueImportModalProps {
  open: boolean;
  plan: LightingPlan;
  role: UserRole;
  onClose: () => void;
  onApply: (text: string) => void;
}

export function RescueImportModal({ open, plan, role, onClose, onApply }: RescueImportModalProps) {
  const [text, setText] = useState(SAMPLE_RESCUE_SHEET);
  const [preview, setPreview] = useState<RescuePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const toast = useToast();

  const canWrite = role === 'designer' || role === 'stage-manager';
  const blockedBroken = preview?.brokenFollows.filter((item) => item.blocked) ?? [];

  function handleAnalyze() {
    const parsed = parseRescueSheetText(text);
    if (parsed.errors.length) {
      setPreview({
        errors: parsed.errors,
        views: [],
        brokenFollows: [],
        affected: [],
        channelHits: [],
        writableCount: 0,
        blockedCount: 0,
        oldPlanDuration: 0,
        newPlanDuration: 0
      });
      return;
    }
    const result = simulateRescueSheet(plan, parsed.sheet);
    setPreview(result);
    setConfirmed(false);
  }

  function handleApply() {
    if (!preview || preview.errors.length || preview.writableCount === 0) return;
    if (blockedBroken.length > 0) {
      toast({
        title: '存在被保护提示的跟随失效，必须先解除冻结或人工处理',
        status: 'error',
        duration: 2600
      });
      return;
    }
    onApply(text);
    toast({ title: '救援单已写入，时间与冲突已重算', status: 'success', duration: 2400 });
    setPreview(null);
    setConfirmed(false);
    onClose();
  }

  function handleClose() {
    setPreview(null);
    setConfirmed(false);
    onClose();
  }

  return (
    <Modal isOpen={open} onClose={handleClose} size="4xl" scrollBehavior="inside" isCentered>
      <ModalOverlay />
      <ModalContent bg="stage.900" borderColor="whiteAlpha.100" borderWidth="1px">
        <ModalHeader>
          <HStack>
            <Siren size={19} color="#f6c453" />
            <Heading size="sm">灯光组救援单导入 · {plan.name}</Heading>
          </HStack>
          <Text color="whiteAlpha.500" fontSize="xs" fontWeight="400" mt={1}>
            先对照当前方案预览失效跟随与受影响提示，舞台监督确认后才会写入；超过 30 项或格式错误整单拒绝，原方案保持不变。
          </Text>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text color="whiteAlpha.600" fontSize="xs" mb={2}>
            救援单 JSON：条目支持 sceneOrder/sceneName + cueNumber 定位，可调整 order、brightness、fadeIn、hold、fadeOut、channel、followCueNumber（null 为清除跟随）；顶层 channelReplacements 做全案通道替换。
          </Text>
          <Textarea
            aria-label="救援单 JSON 内容"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
            }}
            minH="180px"
            fontFamily="mono"
            fontSize="xs"
            bg="blackAlpha.400"
            spellCheck={false}
          />

          <HStack mt={3}>
            <Button size="sm" colorScheme="amber" leftIcon={<ListChecks size={15} />} onClick={handleAnalyze}>
              与当前方案对照
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<RefreshCcw size={14} />} onClick={() => setText(SAMPLE_RESCUE_SHEET)}>
              填入示例
            </Button>
            <Spacer />
            <Text color="whiteAlpha.400" fontSize="xs">当前角色：{roleLabels[role]}</Text>
          </HStack>

          {preview ? <PreviewResult preview={preview} role={role} canWrite={canWrite} confirmed={confirmed} onConfirm={setConfirmed} /> : null}
        </ModalBody>
        <ModalFooter borderTopWidth="1px" borderColor="whiteAlpha.100">
          <Button variant="ghost" onClick={handleClose}>取消</Button>
          <Button
            ml={3}
            colorScheme="amber"
            leftIcon={<Upload size={16} />}
            isDisabled={
              !preview ||
              preview.errors.length > 0 ||
              preview.writableCount === 0 ||
              !confirmed ||
              !canWrite ||
              blockedBroken.length > 0
            }
            onClick={handleApply}
          >
            舞台监督确认并写入
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function PreviewResult({
  preview,
  role,
  canWrite,
  confirmed,
  onConfirm
}: {
  preview: RescuePreview;
  role: UserRole;
  canWrite: boolean;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
}) {
  if (preview.errors.length) {
    return (
      <Alert status="error" borderRadius="lg" mt={4} flexDirection="column" alignItems="start">
        <HStack mb={2}>
          <FileWarning size={18} />
          <AlertTitle>救援单被拒绝，未改动原方案，可修改后重试</AlertTitle>
        </HStack>
        <Stack spacing={1} pl={6}>
          {preview.errors.map((error) => (
            <AlertDescription key={error} fontSize="xs">· {error}</AlertDescription>
          ))}
        </Stack>
      </Alert>
    );
  }

  const durationDelta = preview.newPlanDuration - preview.oldPlanDuration;

  return (
    <Box mt={4}>
      <Divider mb={3} />
      <Flex wrap="wrap" gap={2} mb={3}>
        <Tag colorScheme="blue">{preview.views.length} 条救援项</Tag>
        <Tag colorScheme="green">{preview.writableCount} 条可写入</Tag>
        <Tag colorScheme="red">{preview.blockedCount} 条被冻结/确认拦截</Tag>
        <Tag colorScheme="purple">{preview.channelHits.length} 次通道命中</Tag>
        <Tag colorScheme={preview.brokenFollows.length ? 'orange' : 'green'}>
          {preview.brokenFollows.length} 条跟随关系会失效
        </Tag>
        <Tag colorScheme={durationDelta === 0 ? 'gray' : durationDelta > 0 ? 'orange' : 'blue'}>
          全剧时长 {formatTime(preview.oldPlanDuration)} → {formatTime(preview.newPlanDuration)}
          （{durationDelta >= 0 ? '+' : ''}{durationDelta.toFixed(1)}s）
        </Tag>
      </Flex>

      <SectionTitle icon={<FileWarning size={14} color="#fc8181" />} title="无法越过的保护项" count={preview.blockedCount} tone="red" />
      {preview.views.filter((view) => view.blocked).map((view) => (
        <Box key={`blocked-${view.scene.id}-${view.cue.id}`} p={2} borderRadius="md" bg="red.900" borderWidth="1px" borderColor="red.700" mb={2}>
          <HStack>
            <Lock size={13} color="#fc8181" />
            <Badge fontFamily="mono">{view.cue.number}</Badge>
            <Text fontSize="xs" fontWeight="700">{view.cue.label}</Text>
            <Spacer />
            <Text fontSize="11px" color="red.200">{view.scene.name} · {view.blockReason}</Text>
          </HStack>
          <Text fontSize="11px" color="whiteAlpha.600" mt={1}>请求改动：{view.changes.join('；')}</Text>
        </Box>
      ))}

      <SectionTitle icon={<Link2Off size={14} color="#f6ad55" />} title="会失效的跟随关系" count={preview.brokenFollows.length} tone="orange" />
      {preview.brokenFollows.map((item) => (
        <Box key={`broken-${item.scene.id}-${item.follower.id}`} p={2} borderRadius="md" bg="orange.900" borderWidth="1px" borderColor="orange.700" mb={2}>
          <HStack>
            <Badge fontFamily="mono">{item.follower.number}</Badge>
            <Text fontSize="xs" fontWeight="700">{item.follower.label}</Text>
            <Tag size="sm" colorScheme={item.blocked ? 'red' : 'yellow'}>
              {item.blocked ? '受保护 · 需人工处理' : `写入时自动解除跟随${item.target ? `（${item.target.number}）` : ''}`}
            </Tag>
          </HStack>
          <Text fontSize="11px" color="orange.100" mt={1}>{item.scene.name}：{item.reason}</Text>
        </Box>
      ))}

      <SectionTitle
        icon={<AlertTriangle size={14} color="#f6c453" />}
        title="受影响灯光提示（未确认者将退回未完成）"
        count={preview.affected.length}
        tone="amber"
      />
      <Box maxH="240px" overflowY="auto" borderRadius="md" borderWidth="1px" borderColor="whiteAlpha.100">
        {preview.affected.map((item) => (
          <Flex key={item.key} px={3} py={2} borderBottomWidth="1px" borderColor="whiteAlpha.50" align="center" gap={2}>
            <Box className="color-swatch" bg={item.cue.colorHex} />
            <Badge fontFamily="mono" minW="44px">{item.cue.number}</Badge>
            <Box flex="1" minW={0}>
              <Text fontSize="xs" fontWeight="650" noOfLines={1}>{item.cue.label}</Text>
              <Text fontSize="10px" color="whiteAlpha.500" noOfLines={1}>{item.scene.name} · {item.reason}</Text>
            </Box>
            {item.confirmedLocked ? (
              <Tag size="sm" colorScheme="red">已确认/冻结 · 不改写</Tag>
            ) : item.resetToDraft ? (
              <Tag size="sm" colorScheme="orange">退回未完成</Tag>
            ) : null}
          </Flex>
        ))}
      </Box>

      <SectionTitle icon={<ListChecks size={14} color="#9ae6b4" />} title="可写入条目明细" count={preview.writableCount} tone="green" />
      {preview.views.filter((view) => !view.blocked).map((view) => (
        <Flex key={`write-${view.scene.id}-${view.cue.id}`} px={3} py={2} align="center" gap={2} borderRadius="md" bg="blackAlpha.300" mb={1}>
          <Badge fontFamily="mono">{view.cue.number}</Badge>
          <Box flex="1" minW={0}>
            <Text fontSize="xs" fontWeight="650">{view.cue.label}</Text>
            <Text fontSize="10px" color="whiteAlpha.500">{view.scene.name}</Text>
          </Box>
          <Text fontSize="11px" color="green.200" textAlign="right">{view.changes.join('；')}</Text>
        </Flex>
      ))}

      {!canWrite ? (
        <Alert status="warning" borderRadius="lg" mt={3}>
          <AlertIcon />
          <AlertDescription fontSize="xs">
            {roleLabels[role]}权限不能最终写入：救援单对照后，请切换为舞台监督或灯光设计角色完成确认。
          </AlertDescription>
        </Alert>
      ) : null}

      <Checkbox
        mt={4}
        isChecked={confirmed}
        isDisabled={!canWrite || preview.writableCount === 0}
        onChange={(event) => onConfirm(event.target.checked)}
        aria-label="舞台监督确认：已核对失效跟随与受影响提示，允许写入"
      >
        <Text fontSize="xs">舞台监督确认：已核对失效跟随、受影响提示与保护项，允许写入并重算全剧时间与冲突。</Text>
      </Checkbox>
    </Box>
  );
}

function SectionTitle({
  icon,
  title,
  count,
  tone
}: {
  icon: ReactNode;
  title: string;
  count: number;
  tone: 'red' | 'orange' | 'amber' | 'green';
}) {
  const color = { red: 'red.300', orange: 'orange.300', amber: 'amber.300', green: 'green.300' }[tone];
  return (
    <Flex align="center" gap={2} mt={3} mb={2}>
      {icon}
      <Text fontSize="xs" fontWeight="700" color={color}>{title}</Text>
      <Badge colorScheme={count ? (tone === 'green' ? 'green' : tone === 'amber' ? 'orange' : tone) : 'gray'}>{count}</Badge>
    </Flex>
  );
}
